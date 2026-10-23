import { useEffect, useState } from 'react'
import { Group, Image as KImage, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { SheetItem } from '../../domain/types'
import { assetSrc } from '../../platform/tauri'

type LoadState = { status: 'loading' | 'error' } | { status: 'loaded'; image: HTMLImageElement }

/** Loads an image element for a preview path; `error` when missing or unreadable. */
function usePreviewImage(previewPath: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  useEffect(() => {
    if (!previewPath) {
      setState({ status: 'error' })
      return
    }
    let alive = true
    const img = new window.Image()
    img.onload = () => alive && setState({ status: 'loaded', image: img })
    img.onerror = () => alive && setState({ status: 'error' })
    setState({ status: 'loading' })
    img.src = assetSrc(previewPath)
    return () => {
      alive = false
      img.onload = null
      img.onerror = null
    }
  }, [previewPath])
  return state
}

export interface ItemNodeProps {
  item: SheetItem
  outline: string
  problem: boolean
  problemColor: string
  draggable: boolean
  registerNode(id: string, node: Konva.Group | null): void
  onSelect(id: string, e: Konva.KonvaEventObject<MouseEvent>): void
  onDragMove(item: SheetItem, e: Konva.KonvaEventObject<DragEvent>): void
  onDragEnd(item: SheetItem, node: Konva.Group): void
  onTransformEnd(item: SheetItem, node: Konva.Group): void
  /** Double-click: open the design's page on DTF Creations. */
  onOpen?(item: SheetItem): void
}

/** An item drawn in sheet millimetres: group at the item centre, rotated, image offset by half its size. */
export function ItemNode({
  item,
  outline,
  problem,
  problemColor,
  draggable,
  registerNode,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onOpen,
}: ItemNodeProps) {
  const preview = usePreviewImage(item.asset.previewPath)
  const w = item.widthMm
  const h = item.heightMm
  return (
    <Group
      ref={(node) => registerNode(item.id, node)}
      x={item.xMm + w / 2}
      y={item.yMm + h / 2}
      rotation={item.rotationDeg}
      draggable={draggable}
      onMouseDown={(e) => onSelect(item.id, e)}
      onDblClick={() => onOpen?.(item)}
      onDblTap={() => onOpen?.(item)}
      onDragMove={(e) => onDragMove(item, e)}
      onDragEnd={(e) => onDragEnd(item, e.currentTarget as Konva.Group)}
      onTransformEnd={(e) => onTransformEnd(item, e.currentTarget as Konva.Group)}
    >
      {preview.status === 'loaded' ? (
        <KImage image={preview.image} x={-w / 2} y={-h / 2} width={w} height={h} />
      ) : (
        <>
          <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#c4c8cf" />
          <Text
            x={-w / 2}
            y={-h / 2}
            width={w}
            height={h}
            text={item.source.label}
            align="center"
            verticalAlign="middle"
            fontSize={Math.max(2, Math.min(h / 5, 10))}
            fill="#3d4450"
            listening={false}
          />
        </>
      )}
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        stroke={outline}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={false}
      />
      {problem && (
        <Rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          stroke={problemColor}
          strokeWidth={2}
          dash={[6, 4]}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  )
}
