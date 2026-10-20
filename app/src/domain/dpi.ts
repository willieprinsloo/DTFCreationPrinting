import type { Asset, DpiStatus, DpiThresholds, SheetItem } from './types'

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

export function dpiStatus(dpi: number, t: DpiThresholds = DEFAULT_THRESHOLDS): DpiStatus {
  if (dpi >= t.fine) return 'fine'
  if (dpi >= t.low) return 'low'
  return 'bad'
}
