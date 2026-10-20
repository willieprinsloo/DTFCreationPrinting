import { useEffect, useRef } from 'react'
import { useTheme } from '../../state/theme'
import type { Viewport } from '../../domain/viewport'

export const RULER_PX = 20
/** Labelled steps, in mm; the smallest one that keeps labels this far apart wins. */
const MAJOR_STEPS_MM = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
const MIN_LABEL_GAP_PX = 48
const MIN_TICK_GAP_PX = 5

export interface Tick {
  /** Screen position along the ruler, px from the ruler's start. */
  px: number
  mm: number
  major: boolean
}

/** Ticks for one ruler axis: sheet mm 0..lengthMm mapped through `scale` (px/mm) and `offset` (px). */
export function rulerTicks(scale: number, offset: number, viewPx: number, lengthMm: number): Tick[] {
  if (!(scale > 0) || !(lengthMm > 0)) return []
  const major = MAJOR_STEPS_MM.find((s) => s * scale >= MIN_LABEL_GAP_PX) ?? MAJOR_STEPS_MM[MAJOR_STEPS_MM.length - 1]
  const minor = [10, 5, 2].map((d) => major / d).find((s) => s * scale >= MIN_TICK_GAP_PX) ?? major
  const startMm = Math.max(0, Math.floor(-offset / scale / minor) * minor)
  const endMm = Math.min(lengthMm, (viewPx - offset) / scale)
  const ticks: Tick[] = []
  for (let mm = startMm; mm <= endMm + 1e-6; mm += minor) {
    const r = Math.round(mm * 1000) / 1000
    ticks.push({ px: offset + r * scale, mm: r, major: Math.abs(r / major - Math.round(r / major)) < 1e-6 })
  }
  return ticks
}

interface Props {
  vp: Viewport
  viewW: number
  viewH: number
  sheetW: number
  sheetH: number
  /** Where the lowest design ends (mm); shaded on the left ruler. */
  usedMm: number
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Top and left rulers in cm, pinned to the view edges; they follow zoom and pan. */
export function Rulers({ vp, viewW, viewH, sheetW, sheetH, usedMm }: Props) {
  const theme = useTheme()
  const topRef = useRef<HTMLCanvasElement>(null)
  const leftRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const colors = {
      bg: cssVar('--surface-alt', '#eceef2'),
      film: cssVar('--surface', '#ffffff'),
      border: cssVar('--border', '#d5d9e0'),
      text: cssVar('--text-muted', '#5b6676'),
      accent: cssVar('--accent', '#2563eb'),
    }
    const dpr = window.devicePixelRatio || 1
    const prep = (c: HTMLCanvasElement | null, w: number, h: number) => {
      if (!c) return null
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, w, h)
      ctx.font = `10px ${cssVar('--font-sans', 'sans-serif')}`
      return ctx
    }

    const top = prep(topRef.current, viewW, RULER_PX)
    if (top) {
      top.fillStyle = colors.film
      top.fillRect(vp.offsetX, 0, sheetW * vp.scale, RULER_PX)
      top.strokeStyle = colors.text
      top.fillStyle = colors.text
      top.textBaseline = 'top'
      top.beginPath()
      for (const t of rulerTicks(vp.scale, vp.offsetX, viewW, sheetW)) {
        const x = Math.round(t.px) + 0.5
        top.moveTo(x, RULER_PX)
        top.lineTo(x, t.major ? 4 : RULER_PX - 5)
        if (t.major) top.fillText(String(t.mm / 10), x + 3, 3)
      }
      top.stroke()
      top.fillStyle = colors.border
      top.fillRect(0, RULER_PX - 1, viewW, 1)
    }

    const left = prep(leftRef.current, RULER_PX, viewH)
    if (left) {
      left.fillStyle = colors.film
      left.fillRect(0, vp.offsetY, RULER_PX, sheetH * vp.scale)
      if (usedMm > 0) {
        left.globalAlpha = 0.18
        left.fillStyle = colors.accent
        left.fillRect(0, vp.offsetY, RULER_PX, usedMm * vp.scale)
        left.globalAlpha = 1
      }
      left.strokeStyle = colors.text
      left.fillStyle = colors.text
      left.textBaseline = 'top'
      left.beginPath()
      for (const t of rulerTicks(vp.scale, vp.offsetY, viewH, sheetH)) {
        const y = Math.round(t.px) + 0.5
        left.moveTo(RULER_PX, y)
        left.lineTo(t.major ? 4 : RULER_PX - 5, y)
        if (t.major) {
          left.save()
          left.translate(3, y + 3)
          left.rotate(Math.PI / 2)
          left.fillText(String(t.mm / 10), 0, -RULER_PX + 6)
          left.restore()
        }
      }
      left.stroke()
      left.fillStyle = colors.border
      left.fillRect(RULER_PX - 1, 0, 1, viewH)
    }
  }, [vp, viewW, viewH, sheetW, sheetH, usedMm, theme])

  return (
    <>
      <canvas ref={topRef} className="ruler ruler-top" style={{ width: viewW, height: RULER_PX }} aria-hidden="true" />
      <canvas ref={leftRef} className="ruler ruler-left" style={{ width: RULER_PX, height: viewH }} aria-hidden="true" />
      <div className="ruler-corner" aria-hidden="true">
        cm
      </div>
    </>
  )
}
