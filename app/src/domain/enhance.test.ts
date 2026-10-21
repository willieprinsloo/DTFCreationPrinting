import { describe, expect, it } from 'vitest'
import { enhancePlan } from './enhance'
import type { Asset } from './types'

const raster = (widthPx: number, heightPx: number): Asset => ({ assetId: 'a', path: '/a.png', previewPath: '/a.p.png', widthPx, heightPx })
// 1000 px across 254 mm = 100 dpi
const item = (asset: Asset, widthMm = 254) => ({ asset, widthMm, heightMm: (widthMm * asset.heightPx) / asset.widthPx })

describe('enhancePlan', () => {
  it('enlarges to 300 dpi at the print size, keeping the aspect', () => {
    const p = enhancePlan(item(raster(1000, 500)))!
    expect(p).toMatchObject({ widthPx: 3000, heightPx: 1500, capped: false })
    expect(p.factor).toBeCloseTo(3)
    expect(p.dpi).toBeCloseTo(300)
  })

  it('stops at 4x and says 300 dpi is out of reach', () => {
    const p = enhancePlan(item(raster(500, 500)))! // 50 dpi
    expect(p).toMatchObject({ widthPx: 2000, heightPx: 2000, factor: 4, capped: true })
    expect(p.dpi).toBeCloseTo(200)
  })

  it('never makes more pixels than the engine prints from', () => {
    const p = enhancePlan(item(raster(8000, 8000), 2000))! // ~102 dpi, would be ~23500 px square
    expect(p.widthPx * p.heightPx).toBeLessThanOrEqual(107_374_182)
    expect(p.capped).toBe(false)
    const long = enhancePlan(item(raster(10000, 100), 5080))! // 50 dpi, a 1 x 50 cm strip
    expect(long.widthPx).toBeLessThanOrEqual(30000)
  })

  it('has nothing to do for PDFs or designs that already have the pixels', () => {
    expect(enhancePlan(item({ ...raster(1000, 500), kind: 'pdf' }))).toBeNull()
    expect(enhancePlan(item(raster(3000, 1500)))).toBeNull() // 300 dpi
    expect(enhancePlan(item(raster(2900, 1450)))).toBeNull() // 290 dpi: under 1.05x
  })
})
