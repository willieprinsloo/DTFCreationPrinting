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
