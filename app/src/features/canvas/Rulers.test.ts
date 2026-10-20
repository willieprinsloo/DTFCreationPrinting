import { describe, expect, it } from 'vitest'
import { rulerTicks } from './Rulers'

describe('rulerTicks', () => {
  it('labels every 10 cm and ticks every cm when zoomed out', () => {
    // 0.5 px/mm: 10 cm = 50 px apart.
    const ticks = rulerTicks(0.5, 0, 400, 600)
    expect(ticks.filter((t) => t.major).map((t) => t.mm)).toEqual([0, 100, 200, 300, 400, 500, 600])
    expect(ticks[1]).toMatchObject({ mm: 10, px: 5, major: false })
  })

  it('labels every cm when zoomed in', () => {
    const ticks = rulerTicks(5, 0, 300, 600)
    expect(ticks.filter((t) => t.major).map((t) => t.mm)).toEqual([0, 10, 20, 30, 40, 50, 60])
  })

  it('only covers the film that is in view', () => {
    // Panned so mm 100 sits at px 0; the view shows mm 100..180.
    const ticks = rulerTicks(5, -500, 400, 150)
    expect(ticks[0].mm).toBe(100)
    expect(ticks[ticks.length - 1].mm).toBe(150)
    expect(ticks[0].px).toBe(0)
  })

  it('is empty for a degenerate view', () => {
    expect(rulerTicks(0, 0, 400, 600)).toEqual([])
    expect(rulerTicks(1, 0, 400, 0)).toEqual([])
  })
})
