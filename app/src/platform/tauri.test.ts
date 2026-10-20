import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn((p: string) => `asset://${p}`) }))
import { invoke } from '@tauri-apps/api/core'
import { cacheAsset, importLocalFile, assetSrc } from './tauri'

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
