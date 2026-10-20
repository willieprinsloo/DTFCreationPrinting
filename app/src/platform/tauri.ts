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

export interface StoredCredentials { email: string; password: string }

export function saveCredentials(email: string, password: string): Promise<void> {
  return invoke<void>('save_credentials', { email, password })
}

export function loadCredentials(): Promise<StoredCredentials | null> {
  return invoke<StoredCredentials | null>('load_credentials')
}

export function clearCredentials(): Promise<void> {
  return invoke<void>('clear_credentials')
}
