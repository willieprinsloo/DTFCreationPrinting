import { beforeEach, describe, expect, it } from 'vitest'
import { createDtfClient } from '../api/dtfClient'
import { createMemoryStore } from './persist'
import { createSettingsStore } from './settingsStore'
import {
  createPrintSizeSyncer,
  getPrintSizeSyncStatus,
  mediaSizes,
  resetPrintSizeSyncStatusForTests,
  syncPrintSizes,
  widthsFromMedia,
} from './printSizeSync'

const BASE = 'https://dtfcreations.co.za/api/v1'
type Size = { label: string; print_width_mm: number; print_height_mm: number; [k: string]: unknown }
type Media = { slug: string; name: string; sizes: Size[] }

const CATEGORIES = [
  { id: 'cat-tee', name: 'T-Shirts', slug: 't-shirts' },
  { id: 'cat-bag', name: 'Tote Bags', slug: 'tote-bags' },
]

/** DTF Creations as in backend/app/routers/print_media.py (public GET, admin PUT that replaces the entry). */
function fakeServer(opts: { supported?: boolean; offline?: boolean; onRequest?: (call: string) => Promise<void> } = {}) {
  const db = { media: [] as Media[] }
  const calls: string[] = []
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (opts.offline) throw new TypeError('network down')
    const path = String(url).slice(BASE.length)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)
    await opts.onRequest?.(`${method} ${path}`)
    if (method === 'GET' && path === '/admin/catalog/categories') return reply({ success: true, data: CATEGORIES })
    if (opts.supported === false) return reply({ detail: 'Not Found' }, 404)
    if (method === 'GET' && path === '/print-media') return reply({ success: true, data: db.media })
    const m = path.match(/^\/admin\/print-media\/(.+)$/)
    if (method === 'PUT' && m) {
      const slug = decodeURIComponent(m[1])
      const body = JSON.parse(String(init?.body))
      const row = { slug, name: body.name, sizes: body.sizes }
      db.media = [...db.media.filter((x) => x.slug !== slug), row]
      return reply({ success: true, data: row })
    }
    return reply({}, 500)
  }
  const client = createDtfClient({ baseUrl: BASE, fetch: fetch as typeof globalThis.fetch, loadCredentials: async () => null })
  return { db, calls, client }
}

async function settingsWith(setup?: (s: ReturnType<typeof createSettingsStore>) => Promise<void>) {
  const s = createSettingsStore(createMemoryStore())
  await s.getState().load()
  await setup?.(s)
  return s
}

const size = (label: string, w: number, h = Math.round(w * 1.25), extra: Record<string, unknown> = {}): Size => ({ label, print_width_mm: w, print_height_mm: h, ...extra })
const tees = (...sizes: Size[]): Media => ({ slug: 't-shirts', name: 'T-shirts', sizes })

beforeEach(() => resetPrintSizeSyncStatusForTests())

describe('print media mapping', () => {
  it('matches media to categories by slug and reads One size and the one-size-only flag', () => {
    const table = widthsFromMedia(
      [tees(size('M', 260)), { slug: 'tote-bags', name: 'Bags', sizes: [size('one size', 250, 300, { one_size_only: true })] }, { slug: 'dtf', name: 'DTF', sizes: [size('Half-Meter', 580)] }],
      CATEGORIES,
    )
    expect(table).toEqual({ byType: { 'cat-tee': { M: 260 }, 'cat-bag': { 'One size': 250 } }, oneSizeOnly: { 'cat-bag': true } })
  })

  it('keeps heights and extra fields of existing sizes, and gives new sizes a portrait zone', () => {
    const existing = [size('M', 300, 380, { recommended_dpi: 300 }), size('S', 280, 350)]
    expect(mediaSizes(existing, { m: 310, L: 320 }, false, 'replace')).toEqual([size('M', 310, 380, { recommended_dpi: 300 }), size('L', 320, 400)])
    expect(mediaSizes(existing, { M: 999, L: 320 }, false, 'fill')).toEqual([...existing, size('L', 320, 400)])
    expect(mediaSizes([size('One size', 250, 300)], { 'One size': 250 }, true, 'replace')).toEqual([size('One size', 250, 300, { one_size_only: true })])
  })
})

describe('syncPrintSizes', () => {
  it('keeps print sizes on this PC when DTF Creations has no print media endpoint', async () => {
    const server = fakeServer({ supported: false })
    const s = await settingsWith((s) => s.getState().setPrintWidth('cat-tee', 'M', 260))
    expect(await syncPrintSizes(server.client, s)).toBe('local')
    expect(s.getState().printSizes.byType['cat-tee']).toEqual({ M: 260 })
  })

  it('fills gaps in the shared media on first contact, without overwriting', async () => {
    const server = fakeServer()
    server.db.media = [tees(size('M', 270, 380))]
    const s = await settingsWith(async (s) => {
      await s.getState().setPrintWidth('cat-tee', 'M', 260)
      await s.getState().setPrintWidth('cat-tee', 'L', 280)
      await s.getState().setPrintWidth('cat-bag', null, 250)
    })
    expect(await syncPrintSizes(server.client, s)).toBe('shared')
    expect(server.db.media).toEqual([
      tees(size('M', 270, 380), size('L', 280, 350)),
      { slug: 'tote-bags', name: 'Tote Bags', sizes: [size('One size', 250)] },
    ])
    expect(s.getState().printSizes.byType).toEqual({ 'cat-tee': { M: 270, L: 280 }, 'cat-bag': { 'One size': 250 } })
    expect(s.getState().printSizesSync).toEqual({ dirtyTypes: [], imported: true })
    server.calls.length = 0
    await syncPrintSizes(server.client, s)
    expect(server.calls.filter((c) => c.startsWith('PUT'))).toEqual([])
  })

  it('uploads a changed type, keeping the server’s heights, and the default size stays on this PC', async () => {
    const server = fakeServer()
    server.db.media = [tees(size('M', 260, 380))]
    const s = await settingsWith()
    await syncPrintSizes(server.client, s)
    await s.getState().setPrintWidth('cat-tee', 'XL', 290)
    await s.getState().setPrintWidth('cat-tee', 'M', null)
    await s.getState().setPrintSizes({ defaultSize: 'L' })
    expect(await syncPrintSizes(server.client, s)).toBe('shared')
    expect(server.db.media).toEqual([tees(size('XL', 290))])
    expect(s.getState().printSizes).toMatchObject({ defaultSize: 'L', byType: { 'cat-tee': { XL: 290 } } })
  })

  it('shows another station’s changes', async () => {
    const server = fakeServer()
    const s = await settingsWith()
    await syncPrintSizes(server.client, s)
    server.db.media = [tees(size('S', 240))]
    await syncPrintSizes(server.client, s)
    expect(s.getState().printSizes.byType['cat-tee']).toEqual({ S: 240 })
  })

  it('keeps offline edits marked and uploads them later', async () => {
    const online = fakeServer()
    const s = await settingsWith()
    await syncPrintSizes(online.client, s)
    await s.getState().setPrintWidth('cat-tee', 'M', 260)
    expect(await syncPrintSizes(fakeServer({ offline: true }).client, s)).toBe('pending')
    expect(s.getState().printSizesSync.dirtyTypes).toEqual(['cat-tee'])
    expect(await syncPrintSizes(online.client, s)).toBe('shared')
    expect(online.db.media).toEqual([{ slug: 't-shirts', name: 'T-Shirts', sizes: [size('M', 260)] }])
  })

  it('keeps an edit made while uploading, for the next run', async () => {
    let editDuringUpload = false
    const s = await settingsWith()
    const server = fakeServer({
      onRequest: async (call) => {
        if (editDuringUpload && call.startsWith('PUT')) {
          editDuringUpload = false
          await s.getState().setPrintWidth('cat-tee', 'M', 262)
        }
      },
    })
    await syncPrintSizes(server.client, s)
    await s.getState().setPrintWidth('cat-tee', 'M', 260)
    editDuringUpload = true
    expect(await syncPrintSizes(server.client, s)).toBe('pending')
    expect(server.db.media[0].sizes).toEqual([size('M', 260)])
    expect(s.getState().printSizes.byType['cat-tee']).toEqual({ M: 262 })
    await syncPrintSizes(server.client, s)
    expect(server.db.media[0].sizes).toEqual([size('M', 262, 325)])
  })
})

describe('createPrintSizeSyncer', () => {
  it('runs one sync at a time and one more if asked meanwhile', async () => {
    const server = fakeServer()
    const s = await settingsWith()
    const sync = createPrintSizeSyncer(server.client, s)
    const first = sync()
    void sync()
    void sync()
    await first
    await new Promise((r) => setTimeout(r, 20))
    expect(server.calls.filter((c) => c === 'GET /print-media').length).toBe(2)
    expect(getPrintSizeSyncStatus()).toBe('shared')
  })
})
