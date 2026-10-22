export interface Margins { topMm: number; rightMm: number; bottomMm: number; leftMm: number }
export type InkChannel = 'K' | 'C' | 'M' | 'Y' | 'W'
/** Dot-gain curve points (input, output) in 0..1 per ink; an empty list = linear. */
export type DotGain = Record<InkChannel, [number, number][]>
/** How the PRN engine prints with this printer. */
export interface EngineSettings {
  /** The ink written to each of the PRN's 6 channels, in order. */
  channelOrder: InkChannel[]
  inkLimitPct: number
  whiteDensityPct: number
  whiteChokeMm: number
  screening: 'blueNoise' | 'errorDiffusion'
  dotGain: DotGain
  leadInMm: number
  iccProfilePath?: string
  /** Lighter (-100) to darker (100) slider; 0 = unchanged. */
  darkness: number
  /** Less (50) to more (150) colour slider, %; 100 = unchanged. */
  saturationPct: number
  /** How out-of-range colours are fitted to the printer: squeezed (photos) or clipped (logos). */
  renderIntent: 'perceptual' | 'relativeColorimetric'
}
export interface PrinterProfile extends EngineSettings { id: string; name: string; widthMm: number; xDpi: number; yDpi: number; defaultMargins: Margins; defaultGapMm: number }
export interface SheetSettings { widthMm: number; margins: Margins; gapMm: number; lengthMode: 'auto' | 'fixed'; fixedLengthMm: number; mirror: boolean; whiteEnabled: boolean; allowRotate: boolean }
/**
 * A cached design file. `kind` is missing on older sheets (= raster). PDFs are vector: `widthMm`/`heightMm`
 * is the page size, and `widthPx`/`heightPx` that size at 300 dpi.
 */
export interface Asset { assetId: string; path: string; previewPath: string; widthPx: number; heightPx: number; kind?: 'raster' | 'pdf'; widthMm?: number; heightMm?: number }
export interface SourceRef {
  kind: 'gallery' | 'order-file' | 'local'
  id: string
  label: string
  customerName?: string
  orderId?: string
  orderNumber?: string
  /** Products only: what quick add / the size changer need. All optional so older sheet files still load. */
  productId?: string
  categoryId?: string
  /** Garment size; null = One size. */
  size?: string | null
  /** Sizes the product is offered in. */
  sizes?: string[]
}
/** xMm/yMm = top-left of the un-rotated item; rotation is about the item centre. */
export interface SheetItem { id: string; asset: Asset; source: SourceRef; xMm: number; yMm: number; widthMm: number; heightMm: number; rotationDeg: number; whiteEnabled: boolean }
export interface Sheet { id: string; name: string; profileId: string; settings: SheetSettings; items: SheetItem[] }
export interface Rect { xMm: number; yMm: number; widthMm: number; heightMm: number }
export type DpiStatus = 'fine' | 'low' | 'bad'
export interface DpiThresholds { fine: number; low: number }
export type Problem = { kind: 'overlap'; itemIds: [string, string] } | { kind: 'outside'; itemId: string }
