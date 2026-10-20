import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, MAX_PDF_RENDER_PX, dpiLabel, dpiStatus, effectiveDpi, nativeSizeMm, pdfBadge, pdfPrintedDpi, pdfRenderSize } from './dpi'

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

const grid = { xDpi: 720, yDpi: 1800 }
const pdfItem = (widthMm: number, heightMm: number, rotationDeg = 0) => ({ asset: pdf, widthMm, heightMm, rotationDeg })

describe('PDF print resolution (R13)', () => {
  it('matches the engine (same numbers as compose::tests::pdf_render_size_cross_check_with_the_app)', () => {
    expect(MAX_PDF_RENDER_PX).toBe(107_374_182)
    expect(pdfRenderSize(50, 50, 0, 720, 1800)).toEqual([1417, 3543])
    expect(pdfRenderSize(600, 1000, 0, 720, 1800)).toEqual([8026, 13377])
    expect(pdfRenderSize(300, 300, 0, 720, 1800)).toEqual([8503, 12626])
    expect(pdfRenderSize(300, 600, 90, 720, 1800)).toEqual([7327, 14654])
  })
  it('is null (full printer resolution) unless the engine has to cap it', () => {
    expect(pdfPrintedDpi(pdfItem(70, 50), grid)).toBeNull()
    expect(pdfPrintedDpi({ ...pdfItem(600, 1000), asset: asset(3000, 3000) }, grid)).toBeNull()
    const n = pdfPrintedDpi(pdfItem(600, 1000), grid)!
    expect(Math.abs(n - 339)).toBeLessThanOrEqual(2)
  })
  it('badge: Vector, or Vector · printed at N dpi with Good from 300 and Low from 150', () => {
    expect(pdfBadge(pdfItem(70, 50), grid)).toEqual({ label: 'Vector', status: 'fine' })
    expect(pdfBadge(pdfItem(600, 1000), grid)).toEqual({ label: 'Vector · printed at 339 dpi', status: 'fine' })
    // 600 x 1500 mm -> ~277 dpi
    expect(pdfBadge(pdfItem(600, 1500), grid)).toEqual({ label: 'Vector · printed at 277 dpi', status: 'low' })
    expect(pdfBadge(pdfItem(600, 6000), grid).status).toBe('bad')
  })
})
