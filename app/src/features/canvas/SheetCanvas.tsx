import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Rect, Shape, Stage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { useSheet, getSheetStore } from '../../state/sheetStore'
import { useSettings } from '../../state/settingsStore'
import { findProblems, itemBounds, printableArea, sheetLengthMm } from '../../domain/geometry'
import { dpiStatus, effectiveDpi } from '../../domain/dpi'
import { snapPosition } from '../../domain/snapping'
import type { DpiStatus, Rect as MmRect, Sheet, SheetItem } from '../../domain/types'
import { screenToSheet } from '../../domain/viewport'
import { ItemNode } from './ItemNode'
import { shortcutFor } from './shortcuts'
import { getViewportStore, useViewport } from './useViewport'

const SNAP_THRESHOLD_MM = 2
const GRID_STEP_MM = 10
const ZOOM_STEP = 1.25
const ROTATION_SNAPS = [0, 90, 180, 270]
const ROTATION_SNAP_TOLERANCE_DEG = 5

interface Colors {
  fine: string
  low: string
  bad: string
  accent: string
}

function readColors(): Colors {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    fine: v('--dpi-fine', '#3b82f6'),
    low: v('--dpi-low', '#f59e0b'),
    bad: v('--dpi-bad', '#ef4444'),
    accent: v('--accent', '#2563eb'),
  }
}

function safeProblems(sheet: Sheet): Set<string> {
  try {
    const ids = new Set<string>()
    for (const p of findProblems(sheet)) {
      if (p.kind === 'outside') ids.add(p.itemId)
      else p.itemIds.forEach((id) => ids.add(id))
    }
    return ids
  } catch {
    return new Set()
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

function intersects(a: MmRect, b: MmRect): boolean {
  return a.xMm < b.xMm + b.widthMm && b.xMm < a.xMm + a.widthMm && a.yMm < b.yMm + b.heightMm && b.yMm < a.yMm + a.heightMm
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; offsetX: number; offsetY: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean }

/** The film canvas: stage in screen px, layer content in sheet millimetres via the viewport transform. */
export function SheetCanvas() {
  const sheet = useSheet((s) => s.sheet)
  const selectedIds = useSheet((s) => s.selectedIds)
  const thresholds = useSettings((s) => s.thresholds)

  const sheetW = sheet.settings.widthMm
  const sheetH = sheetLengthMm(sheet)
  const { vp } = useViewport(sheetW, sheetH)

  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  const fittedRef = useRef(false)
  const nodesRef = useRef(new Map<string, Konva.Group>())
  const transformerRef = useRef<Konva.Transformer>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const colors = useMemo(readColors, [])

  // Track the container size; fit once the first real size is known.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width)
      const h = Math.floor(entry.contentRect.height)
      setView({ w, h })
      const vs = getViewportStore().getState()
      vs.setView(w, h)
      if (!fittedRef.current && w > 0 && h > 0) {
        fittedRef.current = true
        vs.fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keyboard shortcuts + Space-to-pan.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.key === ' ') {
        setSpaceDown(true)
        e.preventDefault()
        return
      }
      const action = shortcutFor(e)
      if (!action) return
      e.preventDefault()
      const vs = getViewportStore().getState()
      const ss = getSheetStore().getState()
      switch (action) {
        case 'fit': return vs.fit()
        case 'fitWidth': return vs.fitWidth()
        case 'trueSize': return vs.trueSize()
        case 'zoomIn': return vs.zoomBy(ZOOM_STEP)
        case 'zoomOut': return vs.zoomBy(1 / ZOOM_STEP)
        case 'undo': return ss.undo()
        case 'redo': return ss.redo()
        case 'delete': return ss.selectedIds.length ? ss.removeItems(ss.selectedIds) : undefined
        case 'duplicate': return ss.selectedIds.length ? ss.duplicateItems(ss.selectedIds) : undefined
        case 'selectAll': return ss.select(ss.sheet.items.map((i) => i.id))
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false)
    }
    const onBlur = () => setSpaceDown(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Attach the transformer to the selected item nodes.
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const nodes = selectedIds.map((id) => nodesRef.current.get(id)).filter((n): n is Konva.Group => !!n)
    tr.nodes(nodes)
    tr.getLayer()?.batchDraw()
  }, [selectedIds, sheet.items])

  const registerNode = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodesRef.current.set(id, node)
    else nodesRef.current.delete(id)
  }, [])

  const problemIds = useMemo(() => safeProblems(sheet), [sheet])
  const printable = useMemo<MmRect | null>(() => {
    try {
      return printableArea(sheet.settings)
    } catch {
      return null
    }
  }, [sheet.settings])

  const outlineFor = (item: SheetItem) => {
    const status: DpiStatus = dpiStatus(effectiveDpi(item), thresholds)
    return colors[status]
  }

  const onSelect = useCallback((id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    const ss = getSheetStore().getState()
    if (e.evt.shiftKey) {
      ss.select(ss.selectedIds.includes(id) ? ss.selectedIds.filter((x) => x !== id) : [...ss.selectedIds, id])
    } else if (!ss.selectedIds.includes(id)) {
      ss.select([id])
    }
  }, [])

  const onDragMove = useCallback((item: SheetItem, e: Konva.KonvaEventObject<DragEvent>) => {
    const ss = getSheetStore().getState()
    // Snap only single-item drags; the transformer moves multi-selections together.
    if (e.evt.altKey || ss.selectedIds.length > 1) return
    const node = e.currentTarget as Konva.Group
    const settings = ss.sheet.settings
    let area: MmRect
    try {
      area = printableArea(settings)
    } catch {
      return
    }
    const moved = { ...item, xMm: node.x() - item.widthMm / 2, yMm: node.y() - item.heightMm / 2 }
    const bounds = itemBounds(moved)
    const others = ss.sheet.items.filter((it) => it.id !== item.id).map(itemBounds)
    const snapped = snapPosition(bounds, others, area, SNAP_THRESHOLD_MM, settings.gapMm)
    node.position({ x: node.x() + snapped.xMm - bounds.xMm, y: node.y() + snapped.yMm - bounds.yMm })
  }, [])

  const onDragEnd = useCallback((item: SheetItem, node: Konva.Group) => {
    getSheetStore().getState().updateItem(item.id, {
      xMm: node.x() - item.widthMm / 2,
      yMm: node.y() - item.heightMm / 2,
    })
  }, [])

  const onTransformEnd = useCallback((item: SheetItem, node: Konva.Group) => {
    const widthMm = item.widthMm * Math.abs(node.scaleX())
    const heightMm = item.heightMm * Math.abs(node.scaleY())
    node.scale({ x: 1, y: 1 })
    const rotationDeg = ((node.rotation() % 360) + 360) % 360
    getSheetStore().getState().updateItem(item.id, {
      widthMm,
      heightMm,
      rotationDeg,
      xMm: node.x() - widthMm / 2,
      yMm: node.y() - heightMm / 2,
    })
  }, [])

  const pointer = (stage: Konva.Stage | null) => stage?.getPointerPosition() ?? null

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const p = pointer(e.target.getStage())
    getViewportStore().getState().onWheel(e.evt, p?.x ?? view.w / 2, p?.y ?? view.h / 2)
  }

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    const p = pointer(stage)
    if (!p) return
    const { vp: cur } = getViewportStore().getState()
    if (e.evt.button === 1 || (spaceDown && e.evt.button === 0)) {
      e.evt.preventDefault()
      setGesture({ kind: 'pan', startX: p.x, startY: p.y, offsetX: cur.offsetX, offsetY: cur.offsetY })
      return
    }
    if (e.evt.button !== 0 || e.target !== stage) return
    const mm = screenToSheet(cur, p.x, p.y)
    if (!e.evt.shiftKey) getSheetStore().getState().select([])
    setGesture({ kind: 'marquee', x0: mm.xMm, y0: mm.yMm, x1: mm.xMm, y1: mm.yMm, additive: e.evt.shiftKey })
  }

  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!gesture) return
    const p = pointer(e.target.getStage())
    if (!p) return
    const vs = getViewportStore().getState()
    if (gesture.kind === 'pan') {
      vs.setVp({ ...vs.vp, offsetX: gesture.offsetX + p.x - gesture.startX, offsetY: gesture.offsetY + p.y - gesture.startY })
    } else {
      const mm = screenToSheet(vs.vp, p.x, p.y)
      setGesture({ ...gesture, x1: mm.xMm, y1: mm.yMm })
    }
  }

  const endGesture = () => {
    if (gesture?.kind === 'marquee') {
      const box: MmRect = {
        xMm: Math.min(gesture.x0, gesture.x1),
        yMm: Math.min(gesture.y0, gesture.y1),
        widthMm: Math.abs(gesture.x1 - gesture.x0),
        heightMm: Math.abs(gesture.y1 - gesture.y0),
      }
      if (box.widthMm > 0 && box.heightMm > 0) {
        const ss = getSheetStore().getState()
        const hit = ss.sheet.items.filter((it) => intersects(itemBounds(it), box)).map((it) => it.id)
        const base = gesture.additive ? ss.selectedIds : []
        ss.select([...new Set([...base, ...hit])])
      }
    }
    setGesture(null)
  }

  const { margins } = sheet.settings
  const cursor = gesture?.kind === 'pan' ? 'grabbing' : spaceDown ? 'grab' : 'default'

  return (
    <div ref={containerRef} className="sheet-canvas" style={{ cursor }}>
      {view.w > 0 && view.h > 0 && (
        <Stage
          width={view.w}
          height={view.h}
          x={vp.offsetX}
          y={vp.offsetY}
          scaleX={vp.scale}
          scaleY={vp.scale}
          onWheel={onWheel}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={endGesture}
          onMouseLeave={endGesture}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer listening={false}>
            <Rect x={0} y={0} width={sheetW} height={sheetH} fill="#ffffff" shadowColor="#000" shadowOpacity={0.15} shadowBlur={8} shadowForStrokeEnabled={false} />
            <Shape
              stroke="rgba(28, 35, 48, 0.08)"
              strokeWidth={1}
              strokeScaleEnabled={false}
              sceneFunc={(ctx, shape) => {
                ctx.beginPath()
                for (let x = GRID_STEP_MM; x < sheetW; x += GRID_STEP_MM) {
                  ctx.moveTo(x, 0)
                  ctx.lineTo(x, sheetH)
                }
                for (let y = GRID_STEP_MM; y < sheetH; y += GRID_STEP_MM) {
                  ctx.moveTo(0, y)
                  ctx.lineTo(sheetW, y)
                }
                ctx.strokeShape(shape)
              }}
            />
            {/* Margins as shaded bands */}
            <Rect x={0} y={0} width={margins.leftMm} height={sheetH} fill="rgba(28,35,48,0.08)" />
            <Rect x={sheetW - margins.rightMm} y={0} width={margins.rightMm} height={sheetH} fill="rgba(28,35,48,0.08)" />
            <Rect x={margins.leftMm} y={0} width={sheetW - margins.leftMm - margins.rightMm} height={margins.topMm} fill="rgba(28,35,48,0.08)" />
            <Rect
              x={margins.leftMm}
              y={sheetH - margins.bottomMm}
              width={sheetW - margins.leftMm - margins.rightMm}
              height={margins.bottomMm}
              fill="rgba(28,35,48,0.08)"
            />
            {!printable && <Rect x={0} y={0} width={sheetW} height={sheetH} fill="rgba(239,68,68,0.15)" />}
          </Layer>
          <Layer>
            {sheet.items.map((item) => (
              <ItemNode
                key={item.id}
                item={item}
                outline={outlineFor(item)}
                problem={problemIds.has(item.id)}
                problemColor={colors.bad}
                draggable={!spaceDown}
                registerNode={registerNode}
                onSelect={onSelect}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onTransformEnd={onTransformEnd}
              />
            ))}
            <Transformer
              ref={transformerRef}
              keepRatio
              shiftBehavior="inverted"
              rotationSnaps={ROTATION_SNAPS}
              rotationSnapTolerance={ROTATION_SNAP_TOLERANCE_DEG}
              borderStroke={colors.accent}
              anchorStroke={colors.accent}
              flipEnabled={false}
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
            />
            {gesture?.kind === 'marquee' && (
              <Rect
                x={Math.min(gesture.x0, gesture.x1)}
                y={Math.min(gesture.y0, gesture.y1)}
                width={Math.abs(gesture.x1 - gesture.x0)}
                height={Math.abs(gesture.y1 - gesture.y0)}
                fill="rgba(37,99,235,0.08)"
                stroke={colors.accent}
                strokeWidth={1}
                strokeScaleEnabled={false}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  )
}
