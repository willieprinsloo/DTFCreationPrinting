import { describe, expect, it } from 'vitest'
import { createViewportStore, pinchFactor, shouldAutoFit } from './useViewport'
import { screenToSheet } from '../../domain/viewport'

const wheel = (deltaY: number, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaX: number }> = {}) => ({
  deltaX: 0, deltaY, ctrlKey: false, metaKey: false, shiftKey: false, ...mods,
})

function store() {
  const s = createViewportStore()
  s.getState().setView(800, 600)
  s.getState().setSheetSize(600, 1000)
  s.getState().setVp({ scale: 1, offsetX: 10, offsetY: 20 })
  return s
}

describe('viewport store', () => {
  it('zoomBy keeps the sheet point at the view centre fixed', () => {
    const s = store()
    const before = screenToSheet(s.getState().vp, 400, 300)
    s.getState().zoomBy(2)
    expect(s.getState().vp.scale).toBe(2)
    const after = screenToSheet(s.getState().vp, 400, 300)
    expect(after.xMm).toBeCloseTo(before.xMm)
    expect(after.yMm).toBeCloseTo(before.yMm)
  })

  it('ctrl-wheel (pinch) zooms in at the cursor', () => {
    const s = store()
    const before = screenToSheet(s.getState().vp, 100, 50)
    s.getState().onWheel(wheel(-10, { ctrlKey: true }), 100, 50)
    expect(s.getState().vp.scale).toBeGreaterThan(1)
    const after = screenToSheet(s.getState().vp, 100, 50)
    expect(after.xMm).toBeCloseTo(before.xMm)
    expect(after.yMm).toBeCloseTo(before.yMm)
  })

  it('plain wheel scrolls vertically; shift-wheel scrolls horizontally', () => {
    const s = store()
    s.getState().onWheel(wheel(30), 0, 0)
    expect(s.getState().vp).toEqual({ scale: 1, offsetX: 10, offsetY: -10 })
    s.getState().onWheel(wheel(30, { shiftKey: true }), 0, 0)
    expect(s.getState().vp).toEqual({ scale: 1, offsetX: -20, offsetY: -10 })
  })

  it('fit uses the stored sheet and view size', () => {
    const s = store()
    s.getState().fit()
    const { vp } = s.getState()
    expect(vp.scale).toBeCloseTo((600 - 48) / 1000)
  })
})

describe('pinchFactor', () => {
  it('is the ratio of the new gesture scale to the previous one', () => {
    expect(pinchFactor(1, 1.5)).toBeCloseTo(1.5)
    expect(pinchFactor(1.5, 0.75)).toBeCloseTo(0.5)
  })
  it('is 1 for a non-positive or non-finite previous scale', () => {
    expect(pinchFactor(0, 2)).toBe(1)
    expect(pinchFactor(NaN, 2)).toBe(1)
    expect(pinchFactor(1, 0)).toBe(1)
  })
})

describe('autoFit', () => {
  it('is on by default, cleared by manual navigation, set again by fit()', () => {
    expect(createViewportStore().getState().autoFit).toBe(true)
    const s = store()
    for (const act of [
      () => s.getState().zoomBy(2),
      () => s.getState().zoomAtPoint(2, 10, 10),
      () => s.getState().onWheel(wheel(5), 0, 0),
      () => s.getState().onWheel(wheel(5, { ctrlKey: true }), 0, 0),
      () => s.getState().fitWidth(),
      () => s.getState().trueSize(),
      () => s.getState().setVp({ scale: 1, offsetX: 0, offsetY: 0 }),
    ]) {
      s.getState().fit()
      expect(s.getState().autoFit).toBe(true)
      act()
      expect(s.getState().autoFit).toBe(false)
    }
  })

  it('fit() centres the whole film horizontally with 24px padding', () => {
    const s = store()
    s.getState().fit()
    const { vp } = s.getState()
    expect(vp.scale).toBeCloseTo((600 - 48) / 1000)
    expect(vp.offsetX).toBeCloseTo((800 - 600 * vp.scale) / 2)
  })
})

describe('shouldAutoFit', () => {
  const a = { widthMm: 600, lengthMm: 1000, viewW: 800, viewH: 600 }
  it('fits on first usable size', () => {
    expect(shouldAutoFit(null, a, true)).toBe(true)
  })
  it('never fits when autoFit is off or the view is empty', () => {
    expect(shouldAutoFit(null, a, false)).toBe(false)
    expect(shouldAutoFit(null, { ...a, viewW: 0 }, true)).toBe(false)
    expect(shouldAutoFit(a, { ...a, viewH: 0, lengthMm: 1200 }, true)).toBe(false)
  })
  it('does nothing when nothing changed', () => {
    expect(shouldAutoFit(a, { ...a }, true)).toBe(false)
  })
  it('refits when width, length or view size change', () => {
    expect(shouldAutoFit(a, { ...a, widthMm: 900 }, true)).toBe(true)
    expect(shouldAutoFit(a, { ...a, lengthMm: 1500 }, true)).toBe(true)
    expect(shouldAutoFit(a, { ...a, viewW: 700 }, true)).toBe(true)
    expect(shouldAutoFit(a, { ...a, viewH: 500 }, true)).toBe(true)
  })
})
