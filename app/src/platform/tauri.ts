import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Asset, PrinterProfile, Sheet } from '../domain/types'

export function cacheAsset(url: string, bearer?: string): Promise<Asset> {
  return invoke<Asset>('cache_asset', { url, bearer: bearer ?? null })
}

export function importLocalFile(path: string): Promise<Asset> {
  return invoke<Asset>('import_local_file', { path })
}

export function assetSrc(path: string): string {
  return convertFileSrc(path)
}

/**
 * A small, cached thumbnail of an online image (the app's `thumb` protocol shrinks it once and
 * keeps it on disk). Anything else — a local file, an empty string — is returned as it is.
 */
export function thumbSrc(src: string): string {
  try {
    const u = new URL(src)
    if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.hostname.endsWith('.localhost')) return convertFileSrc(src, 'thumb')
  } catch {
    // not a URL
  }
  return src
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

export interface PrnStats { lines: number; bytes: number; millis: number }
export interface PrnJob { promise: Promise<PrnStats>; cancel(): void }

/** The PRN run was cancelled by the user (not a failure). */
export class PrnCancelledError extends Error {}

/** Must match `prn::CANCELLED` in Rust. */
const CANCELLED = 'Cancelled'

/** Renders the sheet to a PRN at `outPath`; `onProgress` gets the fraction done (0..1). */
export function createPrn(sheet: Sheet, profile: PrinterProfile, outPath: string, onProgress: (fraction: number) => void): PrnJob {
  const jobId = crypto.randomUUID()
  let settled = false
  const promise = (async () => {
    const unlisten = await listen<{ jobId: string; fraction: number }>('prn-progress', (e) => {
      if (e.payload.jobId === jobId) onProgress(e.payload.fraction)
    })
    try {
      return await invoke<PrnStats>('create_prn', {
        sheetJson: JSON.stringify(sheet),
        profileJson: JSON.stringify(profile),
        outPath,
        jobId,
      })
    } catch (e) {
      if (e === CANCELLED) throw new PrnCancelledError(CANCELLED)
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      settled = true
      unlisten()
    }
  })()
  return {
    promise,
    cancel() {
      if (!settled) void invoke('cancel_prn', { jobId }).catch(() => {})
    },
  }
}

/** Enhance was cancelled by the user (not a failure). */
export class EnhanceCancelledError extends Error {}

export type EnhanceKind = 'artwork' | 'photo'
export interface EnhanceJob { promise: Promise<Asset>; cancel(): void }

/** Enlarges a raster design to `widthPx` x `heightPx` with Real-ESRGAN; resolves to the new cached asset. */
export function enhanceAsset(asset: Asset, widthPx: number, heightPx: number, kind: EnhanceKind, onProgress: (fraction: number) => void): EnhanceJob {
  const jobId = crypto.randomUUID()
  let settled = false
  const promise = (async () => {
    const unlisten = await listen<{ jobId: string; fraction: number }>('upscale-progress', (e) => {
      if (e.payload.jobId === jobId) onProgress(e.payload.fraction)
    })
    try {
      return await invoke<Asset>('upscale_asset', { path: asset.path, widthPx, heightPx, kind, jobId })
    } catch (e) {
      if (e === CANCELLED) throw new EnhanceCancelledError(CANCELLED)
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      settled = true
      unlisten()
    }
  })()
  return {
    promise,
    cancel() {
      if (!settled) void invoke('cancel_upscale', { jobId }).catch(() => {})
    },
  }
}

/** Renders a calibration chart PRN ("white" or "colour") using the profile's current settings. */
export function createChartPrn(kind: 'white' | 'colour', profile: PrinterProfile, outPath: string): Promise<PrnStats> {
  return invoke<PrnStats>('create_chart_prn', { kind, profileJson: JSON.stringify(profile), outPath }).catch((e) => {
    throw e instanceof Error ? e : new Error(String(e))
  })
}

/** Opens Finder / Explorer with the file selected. */
export function revealInFolder(path: string): Promise<void> {
  return invoke<void>('reveal_in_folder', { path })
}

export function writeSheetFile(path: string, contents: string): Promise<void> {
  return invoke<void>('write_sheet_file', { path, contents })
}

export function readSheetFile(path: string): Promise<string> {
  return invoke<string>('read_sheet_file', { path })
}
