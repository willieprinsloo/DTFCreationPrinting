import { describe, expect, it } from 'vitest'
import { createViewportStore } from './useViewport'
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
