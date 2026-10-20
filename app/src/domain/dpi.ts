import type { Asset, DpiStatus, DpiThresholds, PrinterProfile, SheetItem } from './types'

const MM_PER_INCH = 25.4

export const DEFAULT_THRESHOLDS: DpiThresholds = { fine: 200, low: 150 }

/** Raster designs are added at this resolution when nothing else sets their size. */
export const NATIVE_DPI = 300

const isPdf = (a: Asset) => a.kind === 'pdf'

/** Source pixels divided by printed inches, per axis; the lower axis wins. PDFs are vector: Infinity. */
export function effectiveDpi(item: Pick<SheetItem, 'asset' | 'widthMm' | 'heightMm'>): number {
  if (isPdf(item.asset)) return Infinity
  const x = item.asset.widthPx / (item.widthMm / MM_PER_INCH)
  const y = item.asset.heightPx / (item.heightMm / MM_PER_INCH)
  return Math.min(x, y)
}

/** Badge text: "300 dpi", or "Vector" for PDFs. */
export function dpiLabel(dpi: number): string {
  return Number.isFinite(dpi) ? `${Math.round(dpi)} dpi` : 'Vector'
}

/** Size a design is added at: a PDF's page size, or the pixels at 300 dpi. */
export function nativeSizeMm(asset: Asset): { widthMm: number; heightMm: number } {
  if (isPdf(asset) && asset.widthMm && asset.heightMm) return { widthMm: asset.widthMm, heightMm: asset.heightMm }
  return { widthMm: (asset.widthPx / NATIVE_DPI) * MM_PER_INCH, heightMm: (asset.heightPx / NATIVE_DPI) * MM_PER_INCH }
}

/** Height / width of the design (page aspect for PDFs); NaN when it has no size. */
export function assetAspect(asset: Asset): number {
  const { widthMm, heightMm } = nativeSizeMm(asset)
  return heightMm / widthMm
}

/** Most pixels the engine renders one PDF item at. Must match `source::MAX_PREPARED_PX` (2 GiB / 20 B). */
export const MAX_PDF_RENDER_PX = 107_374_182
/** Quality bands for a capped PDF's printed dpi (R13), independent of the raster thresholds. */
export const PDF_THRESHOLDS: DpiThresholds = { fine: 300, low: 150 }

/**
 * Pixel size the engine renders a PDF item at — a copy of `compose::pdf_render_size` in Rust (keep
 * them in step; both test the same numbers). The printer grid (x dpi across, y dpi down; swapped for
 * quarter turns, the finer one both ways for other angles); over the budget the finer axis drops
 * towards the coarser one, then both drop evenly.
 */
export function pdfRenderSize(widthMm: number, heightMm: number, rotationDeg: number, xDpi: number, yDpi: number, maxPx = MAX_PDF_RENDER_PX): [number, number] {
  const r = ((rotationDeg % 180) + 180) % 180
  let [da, db] = r === 0 ? [xDpi, yDpi] : r === 90 ? [yDpi, xDpi] : [Math.max(xDpi, yDpi), Math.max(xDpi, yDpi)]
  const wi = widthMm / MM_PER_INCH
  const hi = heightMm / MM_PER_INCH
  let w: number
  let h: number
  if (wi * da * hi * db <= maxPx) {
    w = Math.round(wi * da)
    h = Math.round(hi * db)
  } else {
    const p = maxPx / (wi * hi)
    const coarse = Math.min(da, db)
    if (coarse * coarse <= p) [da, db] = da <= db ? [da, p / da] : [p / db, db]
    else da = db = Math.sqrt(p)
    w = Math.floor(wi * da)
    h = Math.floor(hi * db)
  }
  return [Math.max(w, 1), Math.max(h, 1)]
}

type PdfSized = Pick<SheetItem, 'asset' | 'widthMm' | 'heightMm' | 'rotationDeg'>

/** The dpi (lower axis) a PDF item prints at when the engine has to cap it; null when it prints at full printer resolution (or is not a PDF). */
export function pdfPrintedDpi(item: PdfSized, profile: Pick<PrinterProfile, 'xDpi' | 'yDpi'>): number | null {
  if (!isPdf(item.asset)) return null
  const r = ((item.rotationDeg % 180) + 180) % 180
  const [ga, gb] = r === 0 ? [profile.xDpi, profile.yDpi] : r === 90 ? [profile.yDpi, profile.xDpi] : [Math.max(profile.xDpi, profile.yDpi), Math.max(profile.xDpi, profile.yDpi)]
  const wi = item.widthMm / MM_PER_INCH
  const hi = item.heightMm / MM_PER_INCH
  if (wi * ga * hi * gb <= MAX_PDF_RENDER_PX) return null
  const [w, h] = pdfRenderSize(item.widthMm, item.heightMm, item.rotationDeg, profile.xDpi, profile.yDpi)
  return Math.min(w / wi, h / hi)
}

/** Quality badge for a PDF item: "Vector", or "Vector · printed at N dpi" when capped. */
export function pdfBadge(item: PdfSized, profile: Pick<PrinterProfile, 'xDpi' | 'yDpi'>): { label: string; status: DpiStatus } {
  const n = pdfPrintedDpi(item, profile)
  if (n === null) return { label: 'Vector', status: 'fine' }
  return { label: `Vector · printed at ${Math.floor(n)} dpi`, status: dpiStatus(n, PDF_THRESHOLDS) }
}

export function dpiStatus(dpi: number, t: DpiThresholds = DEFAULT_THRESHOLDS): DpiStatus {
  if (dpi >= t.fine) return 'fine'
  if (dpi >= t.low) return 'low'
  return 'bad'
}
