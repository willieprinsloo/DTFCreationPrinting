import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DpiThresholds, PrinterProfile } from '../domain/types'
import { DEFAULT_THRESHOLDS } from '../domain/dpi'
import { createTauriStore, type KeyValueStore } from './persist'
import { DEFAULT_LIBRARY_PREFS, mergeLibraryPrefs, type LibraryPrefs, type LibraryPrefsPatch } from './libraryPrefs'
import { DEFAULT_PRINT_SIZES, ONE_SIZE, isValidWidth, sanitizePrintSizes, type PrintSizes } from '../domain/printSizes'

export { DEFAULT_LIBRARY_PREFS }
export type { LibraryPrefs, LibraryPrefsPatch }

export const DEFAULT_PROFILE: PrinterProfile = {
  id: 'dtf-60',
  name: 'DTF 60 cm',
  widthMm: 600,
  xDpi: 720,
  yDpi: 1800,
  defaultMargins: { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 },
  defaultGapMm: 3,
}

export const clampDrawerHeight = (px: number) => Math.min(480, Math.max(120, Math.round(px)))

export const MIN_PREVIEW_LENGTH_FLOOR_MM = 100
export const clampMinPreviewLength = (mm: number) =>
  Number.isFinite(mm) ? Math.max(MIN_PREVIEW_LENGTH_FLOOR_MM, mm) : 1000

export interface SettingsData {
  profiles: PrinterProfile[]
  activeProfileId: string
  thresholds: DpiThresholds
  apiBaseUrl: string
  screenPxPerMm: number
  drawerHeightPx: number
  /** Shortest film length (mm) drawn for an auto-length sheet. */
  minPreviewLengthMm: number
  /** Most recent first, de-duplicated, max 20. */
  recentSheets: string[]
  lastPrnFolder?: string
  libraryPrefs: LibraryPrefs
  /** Default print widths per product type × garment size. */
  printSizes: PrintSizes
  loaded: boolean
}

export interface SettingsActions {
  load(): Promise<void>
  upsertProfile(p: PrinterProfile): Promise<void>
  removeProfile(id: string): Promise<void>
  setActiveProfile(id: string): Promise<void>
  /** Throws synchronously if `low >= fine`. */
  setThresholds(t: DpiThresholds): Promise<void>
  setApiBaseUrl(url: string): Promise<void>
  setScreenPxPerMm(v: number): Promise<void>
  /** Clamped to 120-480 px. */
  setDrawerHeight(px: number): Promise<void>
  /** Clamped to at least 100 mm. */
  setMinPreviewLength(mm: number): Promise<void>
  addRecentSheet(path: string): Promise<void>
  setLastPrnFolder(folder: string): Promise<void>
  /** Merged over the current prefs (per tab). */
  setLibraryPrefs(patch: LibraryPrefsPatch): Promise<void>
  /** Merged over the current print sizes (top-level fields replaced); invalid widths are dropped. */
  setPrintSizes(patch: Partial<PrintSizes>): Promise<void>
  /** Shows only the One size column for a type and prints it at that width; per-size widths are kept. */
  setOneSizeOnly(categoryId: string, on: boolean): Promise<void>
  /** Sets one cell (`size` null = One size); a null or non-positive width clears it. */
  setPrintWidth(categoryId: string, size: string | null, widthMm: number | null): Promise<void>
}

export type SettingsState = SettingsData & SettingsActions

const MAX_RECENT_SHEETS = 20
const SETTINGS_KEY = 'settings'

function defaults(): SettingsData {
  return {
    profiles: [DEFAULT_PROFILE],
    activeProfileId: DEFAULT_PROFILE.id,
    thresholds: { ...DEFAULT_THRESHOLDS },
    apiBaseUrl: 'https://dtfcreations.co.za/api/v1',
    screenPxPerMm: 96 / 25.4,
    drawerHeightPx: 200,
    minPreviewLengthMm: 1000,
    recentSheets: [],
    libraryPrefs: DEFAULT_LIBRARY_PREFS,
    printSizes: DEFAULT_PRINT_SIZES,
    loaded: false,
  }
}

export function createSettingsStore(kv: KeyValueStore) {
  return createStore<SettingsState>((set, get) => {
    /** Applies a patch, then persists the whole settings object. */
    const commit = async (patch: Partial<SettingsData>) => {
      set(patch)
      const { loaded: _loaded, ...persisted } = pickData(get())
      await kv.set(SETTINGS_KEY, persisted)
    }
    return {
      ...defaults(),
      async load() {
        const saved = await kv.get<Partial<SettingsData>>(SETTINGS_KEY)
        const merged = { ...defaults(), ...saved, loaded: true }
        merged.libraryPrefs = mergeLibraryPrefs(DEFAULT_LIBRARY_PREFS, saved?.libraryPrefs)
        merged.printSizes = sanitizePrintSizes(saved?.printSizes)
        if (merged.profiles.length === 0) merged.profiles = [DEFAULT_PROFILE]
        if (!merged.profiles.some((p) => p.id === merged.activeProfileId)) {
          merged.activeProfileId = merged.profiles[0].id
        }
        set(merged)
      },
      upsertProfile(p) {
        const { profiles } = get()
        const exists = profiles.some((x) => x.id === p.id)
        return commit({ profiles: exists ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, p] })
      },
      async removeProfile(id) {
        const { profiles, activeProfileId } = get()
        if (profiles.length <= 1 || !profiles.some((p) => p.id === id)) return
        const next = profiles.filter((p) => p.id !== id)
        await commit({ profiles: next, activeProfileId: activeProfileId === id ? next[0].id : activeProfileId })
      },
      setActiveProfile(id) {
        if (!get().profiles.some((p) => p.id === id)) return Promise.resolve()
        return commit({ activeProfileId: id })
      },
      setThresholds(t) {
        if (!(t.low < t.fine)) throw new Error('Low-quality limit must be below the fine-quality limit')
        return commit({ thresholds: { ...t } })
      },
      setApiBaseUrl: (url) => commit({ apiBaseUrl: url }),
      setScreenPxPerMm: (v) => commit({ screenPxPerMm: v }),
      setDrawerHeight: (px) => commit({ drawerHeightPx: clampDrawerHeight(px) }),
      setMinPreviewLength: (mm) => commit({ minPreviewLengthMm: clampMinPreviewLength(mm) }),
      addRecentSheet: (path) =>
        commit({ recentSheets: [path, ...get().recentSheets.filter((p) => p !== path)].slice(0, MAX_RECENT_SHEETS) }),
      setLastPrnFolder: (folder) => commit({ lastPrnFolder: folder }),
      setLibraryPrefs: (patch) => commit({ libraryPrefs: mergeLibraryPrefs(get().libraryPrefs, patch) }),
      setPrintSizes: (patch) => commit({ printSizes: sanitizePrintSizes({ ...get().printSizes, ...patch }) }),
      setOneSizeOnly(categoryId, on) {
        const { printSizes } = get()
        return commit({ printSizes: sanitizePrintSizes({ ...printSizes, oneSizeOnly: { ...printSizes.oneSizeOnly, [categoryId]: on } }) })
      },
      setPrintWidth(categoryId, size, widthMm) {
        const { printSizes } = get()
        const row = { ...printSizes.byType[categoryId] }
        if (isValidWidth(widthMm)) row[size ?? ONE_SIZE] = widthMm
        else delete row[size ?? ONE_SIZE]
        return commit({ printSizes: sanitizePrintSizes({ ...printSizes, byType: { ...printSizes.byType, [categoryId]: row } }) })
      },
    }
  })
}

function pickData(s: SettingsState): SettingsData {
  return {
    profiles: s.profiles,
    activeProfileId: s.activeProfileId,
    thresholds: s.thresholds,
    apiBaseUrl: s.apiBaseUrl,
    screenPxPerMm: s.screenPxPerMm,
    drawerHeightPx: s.drawerHeightPx,
    minPreviewLengthMm: s.minPreviewLengthMm,
    recentSheets: s.recentSheets,
    lastPrnFolder: s.lastPrnFolder,
    libraryPrefs: s.libraryPrefs,
    printSizes: s.printSizes,
    loaded: s.loaded,
  }
}

let tauriSettings: ReturnType<typeof createSettingsStore> | undefined
/** Tauri-backed store, created on first use. */
export function getSettingsStore() {
  tauriSettings ??= createSettingsStore(createTauriStore())
  return tauriSettings
}

export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useStore(getSettingsStore(), selector)
}
