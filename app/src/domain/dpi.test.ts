import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, dpiLabel, dpiStatus, effectiveDpi, nativeSizeMm } from './dpi'

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

const pdf = { assetId: 'p', path: 'p.pdf', previewPath: 'pp', widthPx: 827, heightPx: 591, kind: 'pdf' as const, widthMm: 70, heightMm: 50 }

describe('PDF assets', () => {
  it('are vector: effective dpi is Infinity at any size, status fine, label Vector', () => {
    expect(effectiveDpi({ asset: pdf, widthMm: 7000, heightMm: 5000 })).toBe(Infinity)
    expect(dpiStatus(Infinity)).toBe('fine')
    expect(dpiLabel(Infinity)).toBe('Vector')
    expect(dpiLabel(299.6)).toBe('300 dpi')
  })
  it('native size is the page size in mm; rasters assume 300 dpi', () => {
    expect(nativeSizeMm(pdf)).toEqual({ widthMm: 70, heightMm: 50 })
    const r = nativeSizeMm(asset(3000, 1500))
    expect(r.widthMm).toBeCloseTo(254)
    expect(r.heightMm).toBeCloseTo(127)
  })
  it('older assets without a kind are rasters', () => {
    expect(effectiveDpi({ asset: asset(3000, 3000), widthMm: 254, heightMm: 254 })).toBeCloseTo(300)
  })
})
