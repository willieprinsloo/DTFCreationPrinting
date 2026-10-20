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

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt)
const str = (v: unknown, dflt: string) => (typeof v === 'string' ? v : dflt)

/** Replaces any value outside its allowed set (e.g. from corrupted or older saved settings) with the default. */
function sanitize(p: LibraryPrefs): LibraryPrefs {
  const D = DEFAULT_LIBRARY_PREFS
  return {
    view: oneOf(p.view, ['grid', 'list'], D.view),
    thumbSize: oneOf(p.thumbSize, ['S', 'M', 'L'], D.thumbSize),
    pageSize: oneOf(p.pageSize, PAGE_SIZES, D.pageSize),
    products: {
      categoryId: str(p.products?.categoryId, D.products.categoryId),
      status: oneOf(p.products?.status, ['', 'draft', 'active', 'archived'], D.products.status),
      sort: oneOf(p.products?.sort, ['newest', 'oldest', 'name', 'type'], D.products.sort),
    },
    designs: {
      customerId: str(p.designs?.customerId, D.designs.customerId),
      customerName: str(p.designs?.customerName, D.designs.customerName),
      designType: str(p.designs?.designType, D.designs.designType),
      categoryId: str(p.designs?.categoryId, D.designs.categoryId),
      sort: oneOf(p.designs?.sort, ['newest', 'oldest', 'name'], D.designs.sort),
    },
    orders: {
      status: oneOf(p.orders?.status, ['confirmed', 'in_production', 'both'], D.orders.status),
      date: oneOf(p.orders?.date, ['today', '7d', '30d', 'all'], D.orders.date),
      sort: oneOf(p.orders?.sort, ['newest', 'oldest', 'number', 'customer'], D.orders.sort),
    },
  }
}

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as object) : {})

/** Merges a patch (or older saved prefs) over a base, one level deep per tab; invalid values fall back to defaults. */
export function mergeLibraryPrefs(base: LibraryPrefs, patch: LibraryPrefsPatch | undefined): LibraryPrefs {
  if (!patch || typeof patch !== 'object') return base
  return sanitize({
    ...base,
    ...patch,
    products: { ...base.products, ...obj(patch.products) },
    designs: { ...base.designs, ...obj(patch.designs) },
    orders: { ...base.orders, ...obj(patch.orders) },
  })
}
