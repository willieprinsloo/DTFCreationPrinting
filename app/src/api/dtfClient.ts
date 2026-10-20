import type { Customer, GalleryCategory, GalleryDesign, OrderFile, OrderSummary, Page, ProductCategory, ProductPrintSource, ProductSummary } from './types'

export class AuthRequiredError extends Error {
  constructor(message = 'Sign in to DTF Creations to continue') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

export interface Credentials { email: string; password: string }

export interface DtfClient {
  login(c: Credentials): Promise<void>
  listGalleryDesigns(q: {
    page?: number
    limit?: number
    search?: string
    categoryId?: string
    designType?: string
    owner?: 'public' | string
    sort?: string
    order?: 'asc' | 'desc'
  }): Promise<Page<GalleryDesign>>
  listGalleryCategories(): Promise<GalleryCategory[]>
  listProductCategories(): Promise<ProductCategory[]>
  /** `status` maps to status_filter: 'draft' | 'active' | 'archived'. */
  listProducts(q: { search?: string; categoryId?: string; status?: string; page?: number; limit?: number }): Promise<Page<ProductSummary>>
  getProductPrintSource(id: string): Promise<ProductPrintSource>
  listCustomers(search?: string): Promise<Customer[]>
  getCustomer(id: string): Promise<Customer>
  /** `limit` is capped at 100 by the API; `dateFrom` is an ISO date (created_at >= it). */
  listOrders(q: {
    status?: string
    search?: string
    page?: number
    limit?: number
    sort?: string
    order?: 'asc' | 'desc'
    dateFrom?: string
  }): Promise<Page<OrderSummary>>
  getOrderFiles(orderId: string): Promise<OrderFile[]>
  setOrderStatus(orderId: string, status: string): Promise<void>
  /** Resolves '/uploads/...' against the site origin. */
  absoluteUrl(pathOrUrl: string): string
  token(): string | null
  /** The bearer token, but only for URLs on the API's own origin (never leak it to other hosts). */
  bearerFor(url: string): string | undefined
}

const OFFLINE = "Can't reach DTF Creations — working offline"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function fullName(o: Json): string {
  if (!o || typeof o !== 'object') return ''
  const direct = [o.name, o.surname].map(str).map((x) => x.trim()).filter(Boolean).join(' ')
  if (direct) return direct
  const joined = [o.first_name, o.last_name].map(str).join(' ').trim()
  return joined || str(o.company).trim() || str(o.company_name).trim() || str(o.email).trim()
}

function toPage<T>(body: Json, map: (r: Json) => T): Page<T> {
  const data: Json[] = Array.isArray(body?.data) ? body.data : []
  const meta = body?.meta ?? {}
  return {
    items: data.map(map),
    total: typeof meta.total === 'number' ? meta.total : data.length,
    page: typeof meta.page === 'number' ? meta.page : 1,
    hasNext: Boolean(meta.has_next_page),
  }
}

const isSizeName = (n: unknown) => str(n).trim().toLowerCase() === 'size'

function axisSizes(axes: Json): string[] {
  const list: Json[] = Array.isArray(axes) ? axes : []
  const axis = list.find((a) => isSizeName(a?.name))
  return Array.isArray(axis?.values) ? axis.values.map(str) : []
}

function pickDesignImage(images: Json): string | null {
  const details: Json[] = (Array.isArray(images) ? images : []).filter((i) => i && i.view === 'detail' && i.image_url)
  if (details.length === 0) return null
  const bySource = details.find((i) => /design source$/i.test(str(i.alt_text).trim()))
  const order = (i: Json) => (typeof i.sort_order === 'number' ? i.sort_order : Number.MAX_SAFE_INTEGER)
  const pick = bySource ?? [...details].sort((a, b) => order(a) - order(b))[0]
  return str(pick.image_url)
}

export function createDtfClient(o: {
  baseUrl: string
  fetch: typeof fetch
  loadCredentials: () => Promise<Credentials | null>
}): DtfClient {
  const base = o.baseUrl.replace(/\/+$/, '')
  let token: string | null = null

  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      return await o.fetch(`${base}${path}`, { ...init, headers })
    } catch {
      throw new Error(OFFLINE)
    }
  }

  const login = async (c: Credentials): Promise<void> => {
    const res = await send('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: c.email, password: c.password, user_type: 'admin' }),
    })
    if (res.status === 401 || res.status === 403) throw new AuthRequiredError('Email or password was not accepted')
    if (!res.ok) throw new Error(`Sign in failed (${res.status})`)
    const body = await res.json()
    const t = body?.data?.access_token
    if (typeof t !== 'string' || !t) throw new Error('Sign in failed: no token returned')
    token = t
  }

  /** Sends the request; on 401 re-logs in with stored credentials and retries once. */
  const request = async (path: string, init?: RequestInit): Promise<Json> => {
    let res = await send(path, init)
    if (res.status === 401) {
      const creds = await o.loadCredentials()
      if (!creds) throw new AuthRequiredError()
      token = null
      await login(creds)
      res = await send(path, init)
      if (res.status === 401) throw new AuthRequiredError()
    }
    if (!res.ok) throw new Error(`DTF Creations returned an error (${res.status})`)
    return res.json().catch(() => ({}))
  }

  const query = (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v))
    const s = sp.toString()
    return s ? `?${s}` : ''
  }

  return {
    login,
    async listGalleryDesigns(q) {
      const body = await request(
        `/gallery-designs${query({
          page: q.page,
          limit: q.limit,
          search: q.search,
          gallery_category_id: q.categoryId,
          design_type: q.designType,
          category_owner: q.owner,
          sort: q.sort,
          order: q.order,
        })}`,
      )
      return toPage(body, (r): GalleryDesign => ({
        id: str(r.id),
        name: str(r.name),
        imageUrl: str(r.image_url),
        thumbnailUrl: r.thumbnail_url ? str(r.thumbnail_url) : undefined,
        designType: str(r.design_type),
        galleryCategoryId: str(r.gallery_category_id),
        tags: Array.isArray(r.tags) ? r.tags.map(str) : [],
        createdAt: r.created_at ? str(r.created_at) : undefined,
      }))
    },
    async listGalleryCategories() {
      const body = await request('/gallery-categories')
      const data: Json[] = Array.isArray(body?.data) ? body.data : []
      return data.map((r): GalleryCategory => ({
        id: str(r.id),
        name: str(r.name),
        customerId: r.customer_id ? str(r.customer_id) : undefined,
      }))
    },
    async listProductCategories() {
      const body = await request('/admin/catalog/categories')
      const data: Json[] = Array.isArray(body?.data) ? body.data : []
      return data.map((r): ProductCategory => ({ id: str(r.id), name: str(r.name) }))
    },
    async listProducts(q) {
      const page = q.page ?? 1
      const limit = q.limit ?? 50
      const offset = (page - 1) * limit
      const body = await request(
        `/admin/catalog/products${query({
          search: q.search,
          category_id: q.categoryId,
          status_filter: q.status,
          // Archiving also sets deleted_at, which the list hides unless asked.
          include_archived: q.status === 'archived' ? 'true' : undefined,
          limit,
          offset,
        })}`,
      )
      const data: Json[] = Array.isArray(body?.data) ? body.data : []
      const total = typeof body?.meta?.total === 'number' ? body.meta.total : data.length
      return {
        items: data.map((r): ProductSummary => ({
          id: str(r.id),
          name: str(r.name),
          categoryId: str(r.category_id),
          sizes: axisSizes(r.axes),
          thumbnailUrl: r.primary_image ? str(r.primary_image) : undefined,
          status: r.status ? str(r.status) : undefined,
          createdAt: r.created_at ? str(r.created_at) : undefined,
        })),
        total,
        page,
        hasNext: offset + data.length < total,
      }
    },
    async getProductPrintSource(id) {
      const body = await request(`/admin/catalog/products/${encodeURIComponent(id)}`)
      const d = body?.data ?? {}
      const variants: Json[] = Array.isArray(d.variants) ? d.variants : []
      const present: string[] = []
      for (const v of variants) {
        if (v?.is_active === false) continue
        const entry = Object.entries(v?.axis_values ?? {}).find(([k]) => isSizeName(k))
        const size = entry ? str(entry[1]).trim() : ''
        if (size && !present.includes(size)) present.push(size)
      }
      const ordered = axisSizes(d.axes).filter((s) => present.includes(s))
      return { designUrl: pickDesignImage(d.images), sizes: [...new Set([...ordered, ...present])] }
    },
    async listCustomers(search) {
      const body = await request(`/customers${query({ search, limit: 50 })}`)
      const data: Json[] = Array.isArray(body?.data) ? body.data : []
      return data.map((r): Customer => ({
        id: str(r.id),
        name: str(r.name).trim() || [r.first_name, r.last_name].map(str).join(' ').trim() || str(r.company).trim() || str(r.email),
        email: str(r.email),
      }))
    },
    async getCustomer(id) {
      const body = await request(`/customers/${encodeURIComponent(id)}`)
      const r: Json = body?.data ?? {}
      return { id: str(r.id) || id, name: fullName(r), email: str(r.email) }
    },
    async listOrders(q) {
      const body = await request(`/orders${query({
          status: q.status,
          search: q.search,
          page: q.page,
          limit: q.limit,
          sort: q.sort,
          order: q.order,
          date_from: q.dateFrom,
        })}`)
      return toPage(body, (r): OrderSummary => ({
        id: str(r.id),
        orderNumber: str(r.order_number),
        status: str(r.status),
        customerId: r.customer_id ? str(r.customer_id) : undefined,
        customerName: fullName(r.customer) || str(r.customer_name) || str(r.delivery_name).trim(),
        createdAt: str(r.created_at),
      }))
    },
    async getOrderFiles(orderId) {
      const body = await request(`/orders/${encodeURIComponent(orderId)}/files`)
      const data: Json[] = Array.isArray(body?.data) ? body.data : []
      return data.map((r): OrderFile => ({
        itemId: str(r.item_id),
        printFileUrl: str(r.print_file_url),
        productType: str(r.product_type),
        sizeLabel: str(r.size_label),
      }))
    },
    async setOrderStatus(orderId, status) {
      await request(`/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
    },
    absoluteUrl(pathOrUrl) {
      return new URL(pathOrUrl, new URL(base).origin).toString()
    },
    token: () => token,
    bearerFor(url) {
      if (!token) return undefined
      try {
        return new URL(url).origin === new URL(base).origin ? token : undefined
      } catch {
        return undefined
      }
    },
  }
}
