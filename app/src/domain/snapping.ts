import type { Rect } from './types'

/** Smallest offset that moves one of `edges` onto one of `targets`, if within threshold. */
function bestDelta(edges: number[], targets: number[], thresholdMm: number): number {
  let best = 0
  let bestAbs = Infinity
  for (const e of edges) {
    for (const t of targets) {
      const d = t - e
      const abs = Math.abs(d)
      if (abs <= thresholdMm && abs < bestAbs) {
        best = d
        bestAbs = abs
      }
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

/** 0 means "no snap"; otherwise prefer the smaller adjustment. */
function pickNearest(a: number, b: number): number {
  if (a === 0) return b
  if (b === 0) return a
  return Math.abs(a) <= Math.abs(b) ? a : b
}
