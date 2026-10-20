import type { Customer, GalleryCategory, GalleryDesign, OrderFile, OrderSummary, Page } from './types'

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
  }): Promise<Page<GalleryDesign>>
  listGalleryCategories(): Promise<GalleryCategory[]>
  listCustomers(search?: string): Promise<Customer[]>
  listOrders(q: { status?: string; search?: string; page?: number }): Promise<Page<OrderSummary>>
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
  const direct = str(o.name).trim()
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
    async listCustomers(search) {
      const body = await request(`/customers${query({ search, limit: 50 })}`)
      const data: Json[] = Array.isArray(body?.data) ? body.data : []
      return data.map((r): Customer => ({
        id: str(r.id),
        name: str(r.name).trim() || [r.first_name, r.last_name].map(str).join(' ').trim() || str(r.company).trim() || str(r.email),
        email: str(r.email),
      }))
    },
    async listOrders(q) {
      const body = await request(`/orders${query({ status: q.status, search: q.search, page: q.page })}`)
      return toPage(body, (r): OrderSummary => ({
        id: str(r.id),
        orderNumber: str(r.order_number),
        status: str(r.status),
        customerName: fullName(r.customer) || str(r.customer_name),
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
