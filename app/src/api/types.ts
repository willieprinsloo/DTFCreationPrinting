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
export interface ProductCategory { id: string; name: string; slug?: string }
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
/**
 * One size of a print media (DTF Creations `print_media.sizes`). Extra fields are kept and sent
 * back as they were, so other software's metadata survives the app's edits.
 */
export interface PrintMediaSize {
  label: string
  print_width_mm: number
  print_height_mm: number
  [extra: string]: unknown
}
export interface PrintMedia { slug: string; name: string; sizes: PrintMediaSize[] }
