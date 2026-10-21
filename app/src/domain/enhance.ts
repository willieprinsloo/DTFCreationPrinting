import { effectiveDpi, MAX_PDF_RENDER_PX, NATIVE_DPI } from './dpi'
import type { SheetItem } from './types'

/** The most Enhance enlarges by. Must match `upscale::MAX_FACTOR` in Rust. */
export const MAX_ENHANCE_FACTOR = 4
/** Longest side the engine reads. Must match `source::MAX_SIDE` in Rust. */
const MAX_SIDE_PX = 30000

export interface EnhancePlan {
  widthPx: number
  heightPx: number
  /** Enlargement (output / input). */
  factor: number
  /** The dpi the design prints at once enhanced. */
  dpi: number
  /** True when 300 dpi is out of reach at this print size (the 4x limit). */
  capped: boolean
}

type Sized = Pick<SheetItem, 'asset' | 'widthMm' | 'heightMm'>

/**
 * Pixels to enlarge a raster design to so it prints at 300 dpi at its size on the sheet: aspect
 * kept, at most 4x, never more pixels (or a longer side) than the engine prints from. Null for
 * PDFs and designs that already have the pixels.
 */
export function enhancePlan(item: Sized): EnhancePlan | null {
  const { asset } = item
  if (asset.kind === 'pdf' || !(asset.widthPx > 0 && asset.heightPx > 0)) return null
  const dpi = effectiveDpi(item)
  const wanted = NATIVE_DPI / dpi
  const byPixels = Math.sqrt(MAX_PDF_RENDER_PX / (asset.widthPx * asset.heightPx))
  const bySide = MAX_SIDE_PX / Math.max(asset.widthPx, asset.heightPx)
  const factor = Math.min(wanted, MAX_ENHANCE_FACTOR, byPixels, bySide)
  // Under 1.05x the difference would not show.
  if (!(factor >= 1.05)) return null
  const widthPx = Math.floor(asset.widthPx * factor)
  const heightPx = Math.floor(asset.heightPx * factor)
  return { widthPx, heightPx, factor, dpi: dpi * factor, capped: wanted > MAX_ENHANCE_FACTOR }
}
