import type { DpiStatus, DpiThresholds, SheetItem } from './types'

const MM_PER_INCH = 25.4

export const DEFAULT_THRESHOLDS: DpiThresholds = { fine: 200, low: 150 }

/** Source pixels divided by printed inches, per axis; the lower axis wins. */
export function effectiveDpi(item: Pick<SheetItem, 'asset' | 'widthMm' | 'heightMm'>): number {
  const x = item.asset.widthPx / (item.widthMm / MM_PER_INCH)
  const y = item.asset.heightPx / (item.heightMm / MM_PER_INCH)
  return Math.min(x, y)
}

export function dpiStatus(dpi: number, t: DpiThresholds = DEFAULT_THRESHOLDS): DpiStatus {
  if (dpi >= t.fine) return 'fine'
  if (dpi >= t.low) return 'low'
  return 'bad'
}
