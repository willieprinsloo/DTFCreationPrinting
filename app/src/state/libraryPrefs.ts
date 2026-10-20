/** Library browser filters, sort, view and paging — persisted as one object in settings. */
export type LibraryView = 'grid' | 'list'
export type ThumbSize = 'S' | 'M' | 'L'
export type PageSize = 25 | 50 | 100 | 200
export const PAGE_SIZES: PageSize[] = [25, 50, 100, 200]

export type ProductSort = 'newest' | 'oldest' | 'name' | 'type'
export type DesignSort = 'newest' | 'oldest' | 'name'
export type OrderSort = 'newest' | 'oldest' | 'number' | 'customer'
export type OrderStatusFilter = 'confirmed' | 'in_production' | 'both'
export type OrderDateFilter = 'today' | '7d' | '30d' | 'all'

export interface ProductPrefs { categoryId: string; status: '' | 'draft' | 'active' | 'archived'; sort: ProductSort }
export interface DesignPrefs { customerId: string; customerName: string; designType: string; categoryId: string; sort: DesignSort }
export interface OrderPrefs { status: OrderStatusFilter; date: OrderDateFilter; sort: OrderSort }

export interface LibraryPrefs {
  view: LibraryView
  thumbSize: ThumbSize
  pageSize: PageSize
  products: ProductPrefs
  designs: DesignPrefs
  orders: OrderPrefs
}

export type LibraryPrefsPatch = Partial<Pick<LibraryPrefs, 'view' | 'thumbSize' | 'pageSize'>> & {
  products?: Partial<ProductPrefs>
  designs?: Partial<DesignPrefs>
  orders?: Partial<OrderPrefs>
}

export const DEFAULT_PRODUCT_PREFS: ProductPrefs = { categoryId: '', status: '', sort: 'newest' }
export const DEFAULT_DESIGN_PREFS: DesignPrefs = { customerId: '', customerName: '', designType: '', categoryId: '', sort: 'newest' }
export const DEFAULT_ORDER_PREFS: OrderPrefs = { status: 'confirmed', date: 'all', sort: 'newest' }

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = {
  view: 'grid',
  thumbSize: 'M',
  pageSize: 50,
  products: DEFAULT_PRODUCT_PREFS,
  designs: DEFAULT_DESIGN_PREFS,
  orders: DEFAULT_ORDER_PREFS,
}

/** Merges a patch (or older saved prefs) over a base, one level deep per tab. */
export function mergeLibraryPrefs(base: LibraryPrefs, patch: LibraryPrefsPatch | undefined): LibraryPrefs {
  if (!patch) return base
  return {
    ...base,
    ...patch,
    products: { ...base.products, ...patch.products },
    designs: { ...base.designs, ...patch.designs },
    orders: { ...base.orders, ...patch.orders },
  }
}
