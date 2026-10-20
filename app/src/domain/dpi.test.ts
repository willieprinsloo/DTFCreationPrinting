import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, dpiStatus, effectiveDpi } from './dpi'

const asset = (w: number, h: number) => ({ assetId: 'a', path: 'p', previewPath: 'pp', widthPx: w, heightPx: h })

describe('effectiveDpi', () => {
  it('computes 300 dpi for 3000px over 254mm', () => {
    expect(effectiveDpi({ asset: asset(3000, 3000), widthMm: 254, heightMm: 254 })).toBeCloseTo(300)
  })
  it('computes 180 and 100', () => {
    expect(effectiveDpi({ asset: asset(1800, 1800), widthMm: 254, heightMm: 254 })).toBeCloseTo(180)
    expect(effectiveDpi({ asset: asset(1000, 1000), widthMm: 254, heightMm: 254 })).toBeCloseTo(100)
  })
  it('returns the lower axis', () => {
    expect(effectiveDpi({ asset: asset(3000, 1000), widthMm: 254, heightMm: 254 })).toBeCloseTo(100)
  })
})

describe('dpiStatus', () => {
  it('classifies by default thresholds', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ fine: 200, low: 150 })
    expect(dpiStatus(300)).toBe('fine')
    expect(dpiStatus(180)).toBe('low')
    expect(dpiStatus(100)).toBe('bad')
  })
  it('handles boundaries', () => {
    expect(dpiStatus(200)).toBe('fine')
    expect(dpiStatus(150)).toBe('low')
    expect(dpiStatus(149.9)).toBe('bad')
  })
  it('honours custom thresholds', () => {
    expect(dpiStatus(250, { fine: 300, low: 200 })).toBe('low')
  })
})
