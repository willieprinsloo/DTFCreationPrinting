import { describe, expect, it } from 'vitest'
import { createViewportStore, DEFAULT_ZOOM, pinchFactor, shouldAutoFit } from './useViewport'
import { getSettingsStore } from '../../state/settingsStore'
import { PAN_PADDING_PX, screenToSheet } from '../../domain/viewport'

const wheel = (deltaY: number, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaX: number }> = {}) => ({
  deltaX: 0, deltaY, ctrlKey: false, metaKey: false, shiftKey: false, ...mods,
})

function store() {
  const s = createViewportStore()
  s.getState().setView(800, 600)
  s.getState().setSheetSize(1200, 1000)
  s.getState().setVp({ scale: 1, offsetX: -100, offsetY: 20 })
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
    expect(s.getState().vp).toEqual({ scale: 1, offsetX: -100, offsetY: -10 })
    s.getState().onWheel(wheel(30, { shiftKey: true }), 0, 0)
    expect(s.getState().vp).toEqual({ scale: 1, offsetX: -130, offsetY: -10 })
  })

  it('stops scrolling once the end of the film is near the edge of the view', () => {
    const s = store()
    s.getState().onWheel(wheel(-5000), 0, 0)
    expect(s.getState().vp.offsetY).toBe(PAN_PADDING_PX)
    s.getState().onWheel(wheel(5000), 0, 0)
    expect(s.getState().vp.offsetY).toBe(600 - 1000 - PAN_PADDING_PX)
    s.getState().setVp({ scale: 1, offsetX: 5000, offsetY: -5000 })
    expect(s.getState().vp).toEqual({ scale: 1, offsetX: PAN_PADDING_PX, offsetY: 600 - 1000 - PAN_PADDING_PX })
  })

  it('keeps a film smaller than the view wholly on screen, and re-checks when the film gets shorter', () => {
    const s = store()
    s.getState().zoomBy(0.1) // 120 x 100 px in an 800 x 600 view
    s.getState().onWheel(wheel(5000), 0, 0)
    expect(s.getState().vp.offsetY).toBeCloseTo(PAN_PADDING_PX)
    s.getState().onWheel(wheel(-5000), 0, 0)
    expect(s.getState().vp.offsetY).toBeCloseTo(600 - 100 - PAN_PADDING_PX)
    s.getState().zoomBy(10)
    s.getState().onWheel(wheel(5000), 0, 0)
    s.getState().setSheetSize(1200, 300)
    expect(s.getState().vp.offsetY).toBeCloseTo(PAN_PADDING_PX)
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
    expect(vp.offsetX).toBeCloseTo((800 - 1200 * vp.scale) / 2)
  })

  it('home() opens at 30% of true size, centred across, top of the film in view', () => {
    const s = store()
    s.getState().home()
    const { vp, autoFit, autoMode } = s.getState()
    expect(vp.scale).toBeCloseTo(DEFAULT_ZOOM * getSettingsStore().getState().screenPxPerMm)
    expect(vp.offsetX).toBeCloseTo((800 - 1200 * vp.scale) / 2)
    expect(vp.offsetY).toBe(32)
    expect(autoFit).toBe(true)
    expect(autoMode).toBe('home')
  })

  it('autoView() re-applies home by default and fit after fit()', () => {
    const s = store()
    expect(s.getState().autoMode).toBe('home')
    s.getState().autoView()
    expect(s.getState().vp.offsetY).toBe(32)
    s.getState().fit()
    s.getState().setView(1000, 600)
    s.getState().autoView()
    expect(s.getState().vp.scale).toBeCloseTo((600 - 48) / 1000)
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
