import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn((p: string, scheme = 'asset') => `${scheme}://${p}`) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { DEFAULT_PROFILE } from '../state/settingsStore'
import type { Sheet } from '../domain/types'
import { cacheAsset, importLocalFile, assetSrc, thumbSrc } from './tauri'

const asset = { assetId: 'a', path: '/p', previewPath: '/pp', widthPx: 1, heightPx: 2 }

describe('platform/tauri', () => {
  beforeEach(() => vi.mocked(invoke).mockReset())

  it('cacheAsset invokes cache_asset with url and bearer', async () => {
    vi.mocked(invoke).mockResolvedValue(asset)
    expect(await cacheAsset('u', 't')).toEqual(asset)
    expect(invoke).toHaveBeenCalledWith('cache_asset', { url: 'u', bearer: 't' })
  })
  it('cacheAsset sends null bearer when omitted', async () => {
    vi.mocked(invoke).mockResolvedValue(asset)
    await cacheAsset('u')
    expect(invoke).toHaveBeenCalledWith('cache_asset', { url: 'u', bearer: null })
  })
  it('importLocalFile invokes import_local_file', async () => {
    vi.mocked(invoke).mockResolvedValue(asset)
    expect(await importLocalFile('/x.png')).toEqual(asset)
    expect(invoke).toHaveBeenCalledWith('import_local_file', { path: '/x.png' })
  })
  it('assetSrc wraps convertFileSrc', () => {
    expect(assetSrc('/p')).toBe('asset:///p')
  })
  it('thumbSrc sends online images through the thumbnail cache and leaves the rest alone', () => {
    expect(thumbSrc('https://x.test/u/a.png')).toBe('thumb://https://x.test/u/a.png')
    expect(thumbSrc('http://localhost:8000/u/a.png')).toBe('thumb://http://localhost:8000/u/a.png')
    expect(thumbSrc('http://asset.localhost/C%3A%2Fa.png')).toBe('http://asset.localhost/C%3A%2Fa.png')
    expect(thumbSrc('asset://localhost/a.png')).toBe('asset://localhost/a.png')
    expect(thumbSrc('')).toBe('')
  })
})

describe('platform/tauri credentials', () => {
  beforeEach(() => vi.mocked(invoke).mockReset())
  it('wraps the credential commands', async () => {
    const { saveCredentials, loadCredentials, clearCredentials } = await import('./tauri')
    vi.mocked(invoke).mockResolvedValue(undefined)
    await saveCredentials('a@b.c', 'pw')
    expect(invoke).toHaveBeenCalledWith('save_credentials', { email: 'a@b.c', password: 'pw' })
    vi.mocked(invoke).mockResolvedValue({ email: 'a@b.c', password: 'pw' })
    expect(await loadCredentials()).toEqual({ email: 'a@b.c', password: 'pw' })
    expect(invoke).toHaveBeenCalledWith('load_credentials')
    await clearCredentials()
    expect(invoke).toHaveBeenCalledWith('clear_credentials')
  })
})

describe('platform/tauri createPrn', () => {
  const sheet = { id: 's', name: 'Job', profileId: 'dtf-60', items: [] } as unknown as Sheet
  type Handler = (e: { payload: { jobId: string; fraction: number } }) => void
  let handler: Handler | undefined
  const unlisten = vi.fn()

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    unlisten.mockReset()
    vi.mocked(listen).mockReset().mockImplementation(async (_name, h) => {
      handler = h as unknown as Handler
      return unlisten
    })
  })

  it('invokes create_prn with the sheet, profile and a job id, and forwards only its own progress', async () => {
    const stats = { lines: 10, bytes: 2048, millis: 900 }
    let finish!: (v: unknown) => void
    vi.mocked(invoke).mockImplementation((cmd) => (cmd === 'create_prn' ? new Promise((r) => (finish = r)) : Promise.resolve()))
    const { createPrn } = await import('./tauri')
    const onProgress = vi.fn()
    const job = createPrn(sheet, DEFAULT_PROFILE, '/out/x.prn', onProgress)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('create_prn', expect.anything()))
    expect(listen).toHaveBeenCalledWith('prn-progress', expect.any(Function))
    const args = vi.mocked(invoke).mock.calls[0][1] as { sheetJson: string; profileJson: string; outPath: string; jobId: string }
    expect(JSON.parse(args.sheetJson)).toEqual(sheet)
    expect(JSON.parse(args.profileJson)).toEqual(DEFAULT_PROFILE)
    expect(args.outPath).toBe('/out/x.prn')
    expect(args.jobId).toMatch(/.+/)
    handler!({ payload: { jobId: 'someone-else', fraction: 0.9 } })
    handler!({ payload: { jobId: args.jobId, fraction: 0.25 } })
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(0.25)
    finish(stats)
    expect(await job.promise).toEqual(stats)
    expect(unlisten).toHaveBeenCalled()
  })

  it('cancel calls cancel_prn with the job id; the cancelled run rejects with PrnCancelledError', async () => {
    let fail!: (e: unknown) => void
    vi.mocked(invoke).mockImplementation((cmd) => (cmd === 'create_prn' ? new Promise((_r, j) => (fail = j)) : Promise.resolve()))
    const { createPrn, PrnCancelledError } = await import('./tauri')
    const job = createPrn(sheet, DEFAULT_PROFILE, '/out/x.prn', () => {})
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('create_prn', expect.anything()))
    const { jobId } = vi.mocked(invoke).mock.calls[0][1] as { jobId: string }
    job.cancel()
    expect(invoke).toHaveBeenCalledWith('cancel_prn', { jobId })
    fail('Cancelled')
    await expect(job.promise).rejects.toBeInstanceOf(PrnCancelledError)
    expect(unlisten).toHaveBeenCalled()
  })

  it('passes other engine errors through as Error messages', async () => {
    vi.mocked(invoke).mockRejectedValue('There is nothing to print on this sheet')
    const { createPrn } = await import('./tauri')
    await expect(createPrn(sheet, DEFAULT_PROFILE, '/o.prn', () => {}).promise).rejects.toThrow('There is nothing to print on this sheet')
  })

  it('revealInFolder invokes reveal_in_folder', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const { revealInFolder } = await import('./tauri')
    await revealInFolder('/out/x.prn')
    expect(invoke).toHaveBeenCalledWith('reveal_in_folder', { path: '/out/x.prn' })
  })
})
