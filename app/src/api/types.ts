import type { PrintSizes } from '../domain/printSizes'

export interface Page<T> { items: T[]; total: number; page: number; hasNext: boolean }
export interface GalleryDesign {
  id: string
  name: string
  imageUrl: string
  thumbnailUrl?: string
  designType: string
  galleryCategoryId: string
  tags: string[]
  createdAt?: string
}
export interface GalleryCategory { id: string; name: string; customerId?: string }
export interface Customer { id: string; name: string; email: string }
export interface OrderSummary { id: string; orderNumber: string; status: string; customerId?: string; customerName: string; createdAt: string }
export interface OrderFile { itemId: string; printFileUrl: string; productType: string; sizeLabel: string }
export interface ProductCategory { id: string; name: string }
export interface ProductSummary {
  id: string
  name: string
  categoryId: string
  sizes: string[]
  thumbnailUrl?: string
  /** 'draft' | 'active' | 'archived' */
  status?: string
  createdAt?: string
}
export interface ProductPrintSource { designUrl: string | null; sizes: string[] }
export interface RemoteSizeRow { size: string; position: string; widthMm: number }
/** One product type's entry for PUT /admin/print-sizes/types/{id}: front widths by size, plus untouched other positions. */
export interface RemotePrintSizeType { oneSizeOnly: boolean; widths: Record<string, number>; otherPositions: RemoteSizeRow[] }
export interface RemotePrintSizes {
  revision: number
  /** Front-print widths, in the app's own shape. */
  printSizes: PrintSizes
  /** Rows for back / pocket / sleeve, by category; the app doesn't edit these yet. */
  otherPositions: Record<string, RemoteSizeRow[]>
}
