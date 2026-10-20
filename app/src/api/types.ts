export interface Page<T> { items: T[]; total: number; page: number; hasNext: boolean }
export interface GalleryDesign {
  id: string
  name: string
  imageUrl: string
  thumbnailUrl?: string
  designType: string
  galleryCategoryId: string
  tags: string[]
}
export interface GalleryCategory { id: string; name: string; customerId?: string }
export interface Customer { id: string; name: string; email: string }
export interface OrderSummary { id: string; orderNumber: string; status: string; customerId?: string; customerName: string; createdAt: string }
export interface OrderFile { itemId: string; printFileUrl: string; productType: string; sizeLabel: string }
export interface ProductCategory { id: string; name: string }
export interface ProductSummary { id: string; name: string; categoryId: string; sizes: string[]; thumbnailUrl?: string }
export interface ProductPrintSource { designUrl: string | null; sizes: string[] }
