import type { Rect } from './types'

/** Smallest offset that moves one of `edges` onto one of `targets` within threshold; null when none. */
function bestDelta(edges: number[], targets: number[], thresholdMm: number): number | null {
  let best: number | null = null
  for (const e of edges) {
    for (const t of targets) {
      const d = t - e
      if (Math.abs(d) <= thresholdMm && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

/**
 * Snaps the moving rect's edges to the printable area's left/right/top edges and to
 * other rects' edges (flush or one gap apart) when within `thresholdMm`; per axis, the
 * nearest candidate wins. Returns the (possibly unchanged) top-left position.
 */
export function snapPosition(
  moving: Rect,
  others: Rect[],
  printable: Rect,
  thresholdMm: number,
  gapMm = 0,
): { xMm: number; yMm: number } {
  const left = moving.xMm
  const right = moving.xMm + moving.widthMm
  const top = moving.yMm
  const bottom = moving.yMm + moving.heightMm

  const xTargetsLeft = [printable.xMm]
  const xTargetsRight = [printable.xMm + printable.widthMm]
  const yTargetsTop = [printable.yMm]
  const yTargetsBottom = Number.isFinite(printable.heightMm) ? [printable.yMm + printable.heightMm] : []

  for (const o of others) {
    const oRight = o.xMm + o.widthMm
    const oBottom = o.yMm + o.heightMm
    xTargetsLeft.push(o.xMm, oRight, oRight + gapMm)
    xTargetsRight.push(o.xMm, oRight, o.xMm - gapMm)
    yTargetsTop.push(o.yMm, oBottom, oBottom + gapMm)
    yTargetsBottom.push(o.yMm, oBottom, o.yMm - gapMm)
  }

  const dxLeft = bestDelta([left], xTargetsLeft, thresholdMm)
  const dxRight = bestDelta([right], xTargetsRight, thresholdMm)
  const dyTop = bestDelta([top], yTargetsTop, thresholdMm)
  const dyBottom = bestDelta([bottom], yTargetsBottom, thresholdMm)

  return {
    xMm: left + pickNearest(dxLeft, dxRight),
    yMm: top + pickNearest(dyTop, dyBottom),
  }
}

/** Any match (including an exact 0 alignment) beats no match; otherwise the smaller adjustment wins. */
function pickNearest(a: number | null, b: number | null): number {
  if (a === null) return b ?? 0
  if (b === null) return a
  return Math.abs(a) <= Math.abs(b) ? a : b
}
