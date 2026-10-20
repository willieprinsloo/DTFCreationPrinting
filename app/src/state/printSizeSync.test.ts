import { beforeEach, describe, expect, it } from 'vitest'
import { createDtfClient } from '../api/dtfClient'
import { createMemoryStore } from './persist'
import { createSettingsStore } from './settingsStore'
import { createPrintSizeSyncer, getPrintSizeSyncStatus, resetPrintSizeSyncStatusForTests, syncPrintSizes } from './printSizeSync'

const BASE = 'https://dtfcreations.co.za/api/v1'
type Row = { size: string; position: string; width_mm: number }
type Type = { category_id: string; one_size_only: boolean; sizes: Row[] }

/** A DTF Creations server that follows docs/superpowers/specs/2026-10-20-print-sizes-endpoint.md. */
function fakeServer(opts: { supported?: boolean; offline?: boolean; onRequest?: (call: string) => Promise<void> } = {}) {
  const db = { revision: 0, default_size: 'M', types: [] as Type[] }
  const calls: string[] = []
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const table = () => ({ revision: db.revision, default_size: db.default_size, types: db.types })
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (opts.offline) throw new TypeError('network down')
    const path = String(url).slice(BASE.length)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)
    await opts.onRequest?.(`${method} ${path}`)
    if (opts.supported === false) return reply({ detail: 'Not Found' }, 404)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const m = path.match(/^\/admin\/print-sizes\/types\/(.+)$/)
    if (method === 'GET' && path === '/admin/print-sizes') return reply({ data: table() })
    if (method === 'PUT' && m) {
      const id = decodeURIComponent(m[1])
      db.types = [...db.types.filter((t) => t.category_id !== id), { category_id: id, ...body }]
      db.revision++
      return reply({ data: table() })
    }
    if (method === 'PATCH' && path === '/admin/print-sizes') {
      db.default_size = body.default_size
      db.revision++
      return reply({ data: table() })
    }
    if (method === 'POST' && path === '/admin/print-sizes/import') {
      for (const t of body.types as Type[]) {
        const have = db.types.find((x) => x.category_id === t.category_id)
        if (!have) db.types.push(t)
        else for (const r of t.sizes) if (!have.sizes.some((h) => h.size === r.size && h.position === r.position)) have.sizes.push(r)
      }
      db.revision++
      return reply({ data: { added: 1, skipped_existing: 0, unknown_categories: [], table: table() } })
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

const tee = (sizes: Record<string, number>, one = false): Type => ({
  category_id: 'tee',
  one_size_only: one,
  sizes: Object.entries(sizes).map(([size, width_mm]) => ({ size, position: 'front', width_mm })),
})

beforeEach(() => resetPrintSizeSyncStatusForTests())

describe('syncPrintSizes', () => {
  it('keeps print sizes on this PC when DTF Creations has no endpoint for them', async () => {
    const server = fakeServer({ supported: false })
    const s = await settingsWith((s) => s.getState().setPrintWidth('tee', 'M', 260))
    expect(await syncPrintSizes(server.client, s)).toBe('local')
    expect(s.getState().printSizes.byType.tee).toEqual({ M: 260 })
  })

  it('uploads this PC’s table once on first contact, filling gaps only', async () => {
    const server = fakeServer()
    server.db.types = [tee({ M: 270 })]
    const s = await settingsWith(async (s) => {
      await s.getState().setPrintWidth('tee', 'M', 260)
      await s.getState().setPrintWidth('tee', 'L', 280)
    })
    expect(await syncPrintSizes(server.client, s)).toBe('shared')
    expect(server.calls).toEqual(['GET /admin/print-sizes', 'POST /admin/print-sizes/import'])
    // The server's M wins; this PC's L filled the gap.
    expect(s.getState().printSizes.byType.tee).toEqual({ M: 270, L: 280 })
    expect(s.getState().printSizesSync).toEqual({ dirtyTypes: [], defaultDirty: false, imported: true })
    server.calls.length = 0
    await syncPrintSizes(server.client, s)
    expect(server.calls).toEqual(['GET /admin/print-sizes'])
  })

  it('uploads a changed type and the default size, then takes the server table', async () => {
    const server = fakeServer()
    server.db.types = [{ category_id: 'bag', one_size_only: true, sizes: [{ size: 'One size', position: 'front', width_mm: 250 }] }]
    const s = await settingsWith()
    await syncPrintSizes(server.client, s)
    expect(s.getState().printSizes.byType.bag).toEqual({ 'One size': 250 })
    expect(s.getState().printSizes.oneSizeOnly.bag).toBe(true)

    await s.getState().setPrintWidth('tee', 'XL', 290)
    await s.getState().setPrintSizes({ defaultSize: 'L' })
    expect(await syncPrintSizes(server.client, s)).toBe('shared')
    expect(server.db.types.find((t) => t.category_id === 'tee')).toEqual(tee({ XL: 290 }))
    expect(server.db.default_size).toBe('L')
    expect(s.getState().printSizes).toMatchObject({ defaultSize: 'L', byType: { tee: { XL: 290 }, bag: { 'One size': 250 } } })
  })

  it('sends back sizes for other print positions untouched', async () => {
    const server = fakeServer()
    server.db.types = [{ ...tee({ M: 260 }), sizes: [...tee({ M: 260 }).sizes, { size: 'M', position: 'pocket', width_mm: 90 }] }]
    const s = await settingsWith()
    await syncPrintSizes(server.client, s)
    await s.getState().setPrintWidth('tee', 'M', 265)
    await syncPrintSizes(server.client, s)
    expect(server.db.types[0].sizes).toEqual([
      { size: 'M', position: 'front', width_mm: 265 },
      { size: 'M', position: 'pocket', width_mm: 90 },
    ])
  })

  it('shows another station’s changes', async () => {
    const server = fakeServer()
    const s = await settingsWith()
    await syncPrintSizes(server.client, s)
    server.db.types = [tee({ S: 240 })]
    await syncPrintSizes(server.client, s)
    expect(s.getState().printSizes.byType.tee).toEqual({ S: 240 })
  })

  it('keeps offline edits marked and uploads them later', async () => {
    const online = fakeServer()
    const s = await settingsWith()
    await syncPrintSizes(online.client, s)
    await s.getState().setPrintWidth('tee', 'M', 260)
    expect(await syncPrintSizes(fakeServer({ offline: true }).client, s)).toBe('pending')
    expect(s.getState().printSizesSync.dirtyTypes).toEqual(['tee'])
    expect(await syncPrintSizes(online.client, s)).toBe('shared')
    expect(online.db.types).toEqual([tee({ M: 260 })])
  })

  it('keeps an edit made while uploading, for the next run', async () => {
    let editDuringUpload = false
    const s = await settingsWith()
    const server = fakeServer({
      onRequest: async (call) => {
        if (editDuringUpload && call.startsWith('PUT')) {
          editDuringUpload = false
          await s.getState().setPrintWidth('tee', 'M', 262)
        }
      },
    })
    await syncPrintSizes(server.client, s)
    await s.getState().setPrintWidth('tee', 'M', 260)
    editDuringUpload = true
    expect(await syncPrintSizes(server.client, s)).toBe('pending')
    expect(server.db.types).toEqual([tee({ M: 260 })])
    expect(s.getState().printSizes.byType.tee).toEqual({ M: 262 })
    await syncPrintSizes(server.client, s)
    expect(server.db.types).toEqual([tee({ M: 262 })])
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
    expect(server.calls.filter((c) => c === 'GET /admin/print-sizes').length).toBe(2)
    expect(getPrintSizeSyncStatus()).toBe('shared')
  })
})
