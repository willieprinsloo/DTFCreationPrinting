export interface Viewport {
  /** screen px per mm */
  scale: number
  /** screen px of sheet origin */
  offsetX: number
  offsetY: number
}

export const MIN_SCALE = 0.02
export const MAX_SCALE = 40

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

export function screenToSheet(vp: Viewport, x: number, y: number): { xMm: number; yMm: number } {
  return { xMm: (x - vp.offsetX) / vp.scale, yMm: (y - vp.offsetY) / vp.scale }
}

/** Zoom by `factor`, keeping the sheet point under (screenX, screenY) fixed. */
export function zoomAt(vp: Viewport, factor: number, screenX: number, screenY: number): Viewport {
  const scale = clampScale(vp.scale * factor)
  const ratio = scale / vp.scale
  return {
    scale,
    offsetX: screenX - (screenX - vp.offsetX) * ratio,
    offsetY: screenY - (screenY - vp.offsetY) * ratio,
  }
}

export function fitSheet(
  sheetW: number,
  sheetH: number,
  viewW: number,
  viewH: number,
  paddingPx = 24,
): Viewport {
  const scale = clampScale(
    Math.min((viewW - 2 * paddingPx) / sheetW, (viewH - 2 * paddingPx) / sheetH),
  )
  return {
    scale,
    offsetX: (viewW - sheetW * scale) / 2,
    offsetY: (viewH - sheetH * scale) / 2,
  }
}

export function fitWidth(sheetW: number, viewW: number, paddingPx = 24): Viewport {
  const scale = clampScale((viewW - 2 * paddingPx) / sheetW)
  return { scale, offsetX: (viewW - sheetW * scale) / 2, offsetY: paddingPx }
}

/** `scale` px/mm, film centred across the view, its top `paddingPx` below the view's top. */
export function homeView(sheetW: number, viewW: number, scale: number, paddingPx = 32): Viewport {
  const s = clampScale(scale)
  return { scale: s, offsetX: (viewW - sheetW * s) / 2, offsetY: paddingPx }
}

/** 1:1 physical size, keeping the sheet point at the view centre fixed. */
export function trueSize(
  vp: Viewport,
  screenPxPerMm: number,
  viewW: number,
  viewH: number,
): Viewport {
  const scale = clampScale(screenPxPerMm)
  const cx = viewW / 2
  const cy = viewH / 2
  const { xMm, yMm } = screenToSheet(vp, cx, cy)
  return { scale, offsetX: cx - xMm * scale, offsetY: cy - yMm * scale }
}
