import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type { Asset } from '../domain/types'

export function cacheAsset(url: string, bearer?: string): Promise<Asset> {
  return invoke<Asset>('cache_asset', { url, bearer: bearer ?? null })
}

export function importLocalFile(path: string): Promise<Asset> {
  return invoke<Asset>('import_local_file', { path })
}

export function assetSrc(path: string): string {
  return convertFileSrc(path)
}
