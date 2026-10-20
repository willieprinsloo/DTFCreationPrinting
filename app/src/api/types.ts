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
export interface OrderSummary { id: string; orderNumber: string; status: string; customerName: string; createdAt: string }
export interface OrderFile { itemId: string; printFileUrl: string; productType: string; sizeLabel: string }
