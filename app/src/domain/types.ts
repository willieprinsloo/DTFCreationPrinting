export interface Margins { topMm: number; rightMm: number; bottomMm: number; leftMm: number }
export interface PrinterProfile { id: string; name: string; widthMm: number; xDpi: number; yDpi: number; defaultMargins: Margins; defaultGapMm: number }
export interface SheetSettings { widthMm: number; margins: Margins; gapMm: number; lengthMode: 'auto' | 'fixed'; fixedLengthMm: number; mirror: boolean; whiteEnabled: boolean; allowRotate: boolean }
export interface Asset { assetId: string; path: string; previewPath: string; widthPx: number; heightPx: number }
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
