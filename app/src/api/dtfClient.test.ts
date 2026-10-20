import { describe, it, expect, vi } from 'vitest'
import { createDtfClient, AuthRequiredError } from './dtfClient'

const BASE = 'https://dtfcreations.co.za/api/v1'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const loginOk = (token = 'tok') =>
  json(200, { success: true, data: { user: {}, access_token: token, token_type: 'bearer' } })

function setup(responses: Array<Response | Error>, creds: { email: string; password: string } | null = { email: 'a@b.c', password: 'pw' }) {
  const queue = [...responses]
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  })
  const loadCredentials = vi.fn(async () => creds)
  const client = createDtfClient({ baseUrl: BASE, fetch: fetchMock as unknown as typeof fetch, loadCredentials })
  return { client, fetchMock, loadCredentials }
}

describe('dtfClient', () => {
  it('login posts admin user_type and later requests carry the bearer token', async () => {
    const { client, fetchMock } = setup([loginOk('abc'), json(200, { success: true, data: [{ id: 'c1', name: 'Cat' }] })])
    await client.login({ email: 'a@b.c', password: 'pw' })
    expect(client.token()).toBe('abc')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/auth/login`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.c', password: 'pw', user_type: 'admin' })
    await client.listGalleryCategories()
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer abc')
  })

  it('listGalleryDesigns builds the query and maps fields', async () => {
    const { client, fetchMock } = setup([
      loginOk(),
      json(200, {
        success: true,
        data: [{ id: 'd1', name: 'Star', image_url: '/uploads/s.png', thumbnail_url: '/uploads/t.png', design_type: 'sticker', gallery_category_id: 'g1', tags: ['x'] }],
        meta: { total: 7, page: 2, limit: 1, has_next_page: true },
      }),
    ])
    await client.login({ email: 'a@b.c', password: 'pw' })
    const page = await client.listGalleryDesigns({ owner: 'c1', designType: 'sticker', page: 2, limit: 1, search: 'st', categoryId: 'g1' })
    const url = new URL(fetchMock.mock.calls[1][0] as string)
    expect(url.pathname).toBe('/api/v1/gallery-designs')
    expect(url.searchParams.get('category_owner')).toBe('c1')
    expect(url.searchParams.get('design_type')).toBe('sticker')
    expect(url.searchParams.get('gallery_category_id')).toBe('g1')
    expect(url.searchParams.get('search')).toBe('st')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(page).toEqual({
      items: [{ id: 'd1', name: 'Star', imageUrl: '/uploads/s.png', thumbnailUrl: '/uploads/t.png', designType: 'sticker', galleryCategoryId: 'g1', tags: ['x'] }],
      total: 7,
      page: 2,
      hasNext: true,
    })
  })

  it('on 401 re-logs in with stored credentials and retries once', async () => {
    const { client, fetchMock } = setup([json(401, {}), loginOk('new'), json(200, { success: true, data: [{ id: 'c1', name: 'Cat' }] })])
    const cats = await client.listGalleryCategories()
    expect(cats).toEqual([{ id: 'c1', name: 'Cat', customerId: undefined }])
    const logins = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/login'))
    expect(logins).toHaveLength(1)
    expect((fetchMock.mock.calls[2][1]?.headers as Record<string, string>).Authorization).toBe('Bearer new')
  })

  it('throws AuthRequiredError on 401 without stored credentials', async () => {
    const { client } = setup([json(401, {})], null)
    await expect(client.listGalleryCategories()).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('throws AuthRequiredError on a second 401', async () => {
    const { client } = setup([json(401, {}), loginOk(), json(401, {})])
    await expect(client.listGalleryCategories()).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('throws AuthRequiredError when re-login is rejected', async () => {
    const { client } = setup([json(401, {}), json(401, {})])
    await expect(client.listGalleryCategories()).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('login failure with bad credentials throws AuthRequiredError', async () => {
    const { client } = setup([json(401, { detail: 'bad' })])
    await expect(client.login({ email: 'x', password: 'y' })).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('maps a network failure to the offline message', async () => {
    const { client } = setup([new TypeError('Failed to fetch')])
    await expect(client.listGalleryCategories()).rejects.toThrow("Can't reach DTF Creations — working offline")
  })

  it('absoluteUrl resolves site-relative paths against the origin', () => {
    const { client } = setup([])
    expect(client.absoluteUrl('/uploads/a.png')).toBe('https://dtfcreations.co.za/uploads/a.png')
    expect(client.absoluteUrl('https://cdn.x/y.png')).toBe('https://cdn.x/y.png')
  })

  it('bearerFor only returns the token for the API origin', async () => {
    const { client } = setup([loginOk()])
    await client.login({ email: 'a', password: 'b' })
    expect(client.bearerFor('https://dtfcreations.co.za/uploads/a.png')).toBe(client.token())
    expect(client.bearerFor('https://cdn.example.com/x.png')).toBeUndefined()
    expect(client.bearerFor('not a url')).toBeUndefined()
  })

  it('maps customers defensively', async () => {
    const { client } = setup([
      loginOk(),
      json(200, { success: true, data: [{ id: 'u1', first_name: 'Ann', last_name: 'Lee', email: 'a@l.c' }, { id: 'u2', company: 'Acme', email: 'x@y.z' }, { id: 'u3', name: 'Bob' }] }),
    ])
    await client.login({ email: 'a', password: 'b' })
    expect(await client.listCustomers('a')).toEqual([
      { id: 'u1', name: 'Ann Lee', email: 'a@l.c' },
      { id: 'u2', name: 'Acme', email: 'x@y.z' },
      { id: 'u3', name: 'Bob', email: '' },
    ])
  })

  it('maps orders, order files and sets status', async () => {
    const { client, fetchMock } = setup([
      loginOk(),
      json(200, { success: true, data: [{ id: 'o1', order_number: 'DTF-1', status: 'paid', customer: { first_name: 'Ann', last_name: 'Lee' }, created_at: '2026-01-01' }, { id: 'o2', order_number: 'DTF-2', status: 'new', customer_name: 'Zed', created_at: 'z' }], meta: { total: 2, page: 1, has_next_page: false } }),
      json(200, { success: true, data: [{ item_id: 'i1', print_file_url: '/uploads/p.png', product_type: 'dtf', size_label: 'A4' }] }),
      json(200, { success: true, data: {} }),
    ])
    await client.login({ email: 'a', password: 'b' })
    const orders = await client.listOrders({ status: 'paid', search: 'x', page: 1 })
    expect(orders.items.map((o) => [o.orderNumber, o.customerName])).toEqual([['DTF-1', 'Ann Lee'], ['DTF-2', 'Zed']])
    expect(orders.hasNext).toBe(false)
    expect(await client.getOrderFiles('o1')).toEqual([{ itemId: 'i1', printFileUrl: '/uploads/p.png', productType: 'dtf', sizeLabel: 'A4' }])
    await client.setOrderStatus('o1', 'printed')
    const [url, init] = fetchMock.mock.calls[3]
    expect(String(url)).toBe(`${BASE}/orders/o1/status`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ status: 'printed' })
  })
  it('maps order customerId, delivery_name fallback and getCustomer', async () => {
    const { client, fetchMock } = setup([
      loginOk(),
      json(200, { success: true, data: [{ id: 'o1', order_number: 'D1', status: 'confirmed', customer_id: 'c1', delivery_name: 'Dee Livery', created_at: 'z' }], meta: { total: 1, page: 1, has_next_page: false } }),
      json(200, { success: true, data: { id: 'c1', name: 'Ann', surname: 'Lee', email: 'a@l.c' } }),
    ])
    await client.login({ email: 'a', password: 'b' })
    const o = (await client.listOrders({ status: 'confirmed' })).items[0]
    expect(o).toMatchObject({ customerId: 'c1', customerName: 'Dee Livery' })
    expect(await client.getCustomer('c1')).toEqual({ id: 'c1', name: 'Ann Lee', email: 'a@l.c' })
    expect(new URL(fetchMock.mock.calls[2][0] as string).pathname).toBe('/api/v1/customers/c1')
  })
  it('listGalleryDesigns sends sort/order and maps createdAt', async () => {
    const { client, fetchMock } = setup([
      loginOk(),
      json(200, { success: true, data: [{ id: 'd1', name: 'S', image_url: '/s.png', design_type: 't', gallery_category_id: 'g', created_at: '2026-10-02T00:00:00' }], meta: { total: 1, page: 1, has_next_page: false } }),
    ])
    await client.login({ email: 'a@b.c', password: 'pw' })
    const page = await client.listGalleryDesigns({ sort: 'created_at', order: 'desc' })
    const url = new URL(fetchMock.mock.calls[1][0] as string)
    expect(url.searchParams.get('sort')).toBe('created_at')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(page.items[0].createdAt).toBe('2026-10-02T00:00:00')
  })

  it('listOrders sends limit, sort, order and date_from', async () => {
    const { client, fetchMock } = setup([loginOk(), json(200, { success: true, data: [], meta: { total: 0, page: 1, has_next_page: false } })])
    await client.login({ email: 'a@b.c', password: 'pw' })
    await client.listOrders({ status: 'confirmed', page: 2, limit: 50, sort: 'created_at', order: 'desc', dateFrom: '2026-10-13' })
    const sp = new URL(fetchMock.mock.calls[1][0] as string).searchParams
    expect(Object.fromEntries(sp)).toEqual({ status: 'confirmed', page: '2', limit: '50', sort: 'created_at', order: 'desc', date_from: '2026-10-13' })
  })

  describe('products', () => {
    it('listProductCategories maps id and name', async () => {
      const { client, fetchMock } = setup([loginOk(), json(200, { success: true, data: [{ id: 3, name: 'T-Shirts', slug: 't' }] })])
      await client.login({ email: 'a@b.c', password: 'pw' })
      expect(await client.listProductCategories()).toEqual([{ id: '3', name: 'T-Shirts' }])
      expect(new URL(fetchMock.mock.calls[1][0] as string).pathname).toBe('/api/v1/admin/catalog/categories')
    })

    it('listProducts builds offset query and extracts Size values', async () => {
      const { client, fetchMock } = setup([
        loginOk(),
        json(200, {
          success: true,
          data: [
            { id: 9, name: 'Tee', category_id: 3, axes: [{ name: 'Colour', values: ['Red'] }, { name: 'size', values: ['S', 'M'] }], primary_image: '/uploads/t.png' },
            { id: 10, name: 'Mug', category_id: 4, axes: [], primary_image: null },
          ],
          meta: { total: 120, limit: 50, offset: 50 },
        }),
      ])
      await client.login({ email: 'a@b.c', password: 'pw' })
      const page = await client.listProducts({ search: 'te', categoryId: '3', page: 2, limit: 50 })
      const url = new URL(fetchMock.mock.calls[1][0] as string)
      expect(url.pathname).toBe('/api/v1/admin/catalog/products')
      expect(url.searchParams.get('offset')).toBe('50')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('search')).toBe('te')
      expect(url.searchParams.get('category_id')).toBe('3')
      expect(url.searchParams.has('status_filter')).toBe(false)
      expect(page.items).toEqual([
        { id: '9', name: 'Tee', categoryId: '3', sizes: ['S', 'M'], thumbnailUrl: '/uploads/t.png' },
        { id: '10', name: 'Mug', categoryId: '4', sizes: [], thumbnailUrl: undefined },
      ])
      expect(page).toMatchObject({ total: 120, page: 2, hasNext: true })
    })

    it('listProducts sends status_filter and maps status + createdAt', async () => {
      const { client, fetchMock } = setup([
        loginOk(),
        json(200, { success: true, data: [{ id: 1, name: 'Cap', category_id: 2, axes: [], status: 'active', created_at: '2026-10-01T10:00:00' }], meta: { total: 1 } }),
      ])
      await client.login({ email: 'a@b.c', password: 'pw' })
      const page = await client.listProducts({ status: 'active' })
      expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('status_filter')).toBe('active')
      expect(page.items[0]).toMatchObject({ status: 'active', createdAt: '2026-10-01T10:00:00' })
    })

    const detail = (images: unknown[], variants: unknown[] = [], axes: unknown[] = []) =>
      json(200, { success: true, data: { id: 9, axes, variants, images } })

    it('getProductPrintSource picks the design-source detail image and active sizes in axes order', async () => {
      const { client } = setup([
        loginOk(),
        detail(
          [
            { image_url: '/uploads/main.png', view: 'front', sort_order: 0 },
            { image_url: '/uploads/d2.png', view: 'detail', sort_order: 5, alt_text: 'other' },
            { image_url: '/uploads/d1.png', view: 'detail', sort_order: 99, alt_text: 'Tee — design source' },
          ],
          [
            { axis_values: { Size: 'L' }, is_active: true },
            { axis_values: { Size: 'M' }, is_active: true },
            { axis_values: { Size: 'M', Colour: 'Red' }, is_active: true },
            { axis_values: { Size: 'XL' }, is_active: false },
          ],
          [{ name: 'Size', values: ['S', 'M', 'L', 'XL'] }],
        ),
      ])
      await client.login({ email: 'a@b.c', password: 'pw' })
      expect(await client.getProductPrintSource('9')).toEqual({ designUrl: '/uploads/d1.png', sizes: ['M', 'L'] })
    })

    it('falls back to the lowest sort_order detail image, and null when there is none', async () => {
      const { client } = setup([
        loginOk(),
        detail([
          { image_url: '/uploads/b.png', view: 'detail', sort_order: 7 },
          { image_url: '/uploads/a.png', view: 'detail', sort_order: 2 },
        ]),
        detail([{ image_url: '/uploads/main.png', view: 'front', sort_order: 0 }]),
      ])
      await client.login({ email: 'a@b.c', password: 'pw' })
      expect((await client.getProductPrintSource('9')).designUrl).toBe('/uploads/a.png')
      expect(await client.getProductPrintSource('9')).toEqual({ designUrl: null, sizes: [] })
    })
  })
})
