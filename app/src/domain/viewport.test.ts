import { describe, it, expect } from 'vitest'
import { clampScale, zoomAt, fitSheet, fitWidth, trueSize, screenToSheet, MIN_SCALE, MAX_SCALE } from './viewport'

const base = { scale: 1, offsetX: 0, offsetY: 0 }

describe('viewport', () => {
  it('zoomAt keeps the sheet point under the cursor fixed', () => {
    const r = zoomAt(base, 2, 100, 100)
    expect(r.scale).toBe(2)
    expect(screenToSheet(r, 100, 100)).toEqual(screenToSheet(base, 100, 100))
  })
  it('zoomAt keeps the point fixed with a non-trivial viewport', () => {
    const vp = { scale: 3, offsetX: 40, offsetY: -20 }
    const r = zoomAt(vp, 1.5, 250, 130)
    const a = screenToSheet(vp, 250, 130)
    const b = screenToSheet(r, 250, 130)
    expect(b.xMm).toBeCloseTo(a.xMm)
    expect(b.yMm).toBeCloseTo(a.yMm)
  })
  it('clamps scale', () => {
    expect(zoomAt(base, 1000, 0, 0).scale).toBe(MAX_SCALE)
    expect(zoomAt(base, 0.00001, 0, 0).scale).toBe(MIN_SCALE)
    expect(clampScale(5)).toBe(5)
  })
  it('fitSheet fits and centres a 10 m sheet', () => {
    const r = fitSheet(600, 10000, 1200, 800)
    expect(r.scale).toBeCloseTo(0.0752)
    expect(r.offsetX).toBeCloseTo((1200 - 600 * r.scale) / 2)
    expect(r.offsetY).toBeCloseTo(24)
  })
  it('fitWidth fits width with top padding', () => {
    const r = fitWidth(600, 1248)
    expect(r.scale).toBe(2)
    expect(r.offsetY).toBe(24)
    expect(r.offsetX).toBe(24)
  })
  it('trueSize sets 1:1 scale and keeps the view centre fixed', () => {
    const vp = { scale: 2, offsetX: 30, offsetY: 10 }
    const r = trueSize(vp, 3.78, 1000, 600)
    expect(r.scale).toBe(3.78)
    const a = screenToSheet(vp, 500, 300)
    const b = screenToSheet(r, 500, 300)
    expect(b.xMm).toBeCloseTo(a.xMm)
    expect(b.yMm).toBeCloseTo(a.yMm)
  })
  it('screenToSheet inverts the transform', () => {
    expect(screenToSheet({ scale: 2, offsetX: 10, offsetY: 20 }, 110, 220)).toEqual({ xMm: 50, yMm: 100 })
  })
})
