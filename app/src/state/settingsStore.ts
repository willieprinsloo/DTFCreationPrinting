import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DpiThresholds, PrinterProfile } from '../domain/types'
import { DEFAULT_THRESHOLDS } from '../domain/dpi'
import { createTauriStore, type KeyValueStore } from './persist'
import { DEFAULT_LIBRARY_PREFS, mergeLibraryPrefs, type LibraryPrefs, type LibraryPrefsPatch } from './libraryPrefs'
import { DEFAULT_ENGINE_SETTINGS, sanitizeEngineSettings } from '../domain/engineSettings'
import { isThemeChoice, type ThemeChoice } from '../domain/theme'
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
  ...DEFAULT_ENGINE_SETTINGS,
}

/** Fills engine settings missing from older saved profiles and repairs bad ones. */
export function sanitizeProfile(p: PrinterProfile): PrinterProfile {
  const { iccProfilePath: _icc, ...rest } = p
  return { ...rest, ...sanitizeEngineSettings(p) }
}

export const clampDrawerHeight = (px: number) => Math.min(480, Math.max(120, Math.round(px)))

export const MIN_PREVIEW_LENGTH_FLOOR_MM = 100
export const clampMinPreviewLength = (mm: number) =>
  Number.isFinite(mm) ? Math.max(MIN_PREVIEW_LENGTH_FLOOR_MM, mm) : 1000

/** Bookkeeping for sharing print sizes with DTF Creations. */
export interface PrintSizesSync {
  /** Types changed here and not yet uploaded (also kept across restarts, for offline edits). */
  dirtyTypes: string[]
  /** This PC's table was offered to the server once (the server only fills gaps). */
  imported: boolean
}

export const DEFAULT_PRINT_SIZES_SYNC: PrintSizesSync = { dirtyTypes: [], imported: false }

function sanitizeSync(raw: Partial<PrintSizesSync> | undefined): PrintSizesSync {
  return {
    dirtyTypes: Array.isArray(raw?.dirtyTypes) ? raw.dirtyTypes.filter((c): c is string => typeof c === 'string') : [],
    imported: raw?.imported === true,
  }
}

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
  printSizesSync: PrintSizesSync
  /** Light or dark look; `system` follows the computer. */
  theme: ThemeChoice
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
  /**
   * Takes the server's widths as the truth, except for types changed here since `pushed` was read:
   * those keep the local values and stay marked for upload. The default size is this PC's own.
   */
  applyServerPrintSizes(server: Omit<PrintSizes, 'defaultSize'>, pushedTypes: string[]): Promise<void>
  markPrintSizesImported(): Promise<void>
  setTheme(theme: ThemeChoice): Promise<void>
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
    printSizesSync: DEFAULT_PRINT_SIZES_SYNC,
    theme: 'system',
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
        merged.printSizesSync = sanitizeSync(saved?.printSizesSync)
        if (!isThemeChoice(merged.theme)) merged.theme = 'system'
        merged.profiles = Array.isArray(merged.profiles) ? merged.profiles.map(sanitizeProfile) : []
        if (merged.profiles.length === 0) merged.profiles = [DEFAULT_PROFILE]
        if (!merged.profiles.some((p) => p.id === merged.activeProfileId)) {
          merged.activeProfileId = merged.profiles[0].id
        }
        set(merged)
      },
      upsertProfile(raw) {
        const p = sanitizeProfile(raw)
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
      setPrintSizes(patch) {
        const { printSizesSync: sync } = get()
        const changed = [...Object.keys(patch.byType ?? {}), ...Object.keys(patch.oneSizeOnly ?? {})]
        return commit({
          printSizes: sanitizePrintSizes({ ...get().printSizes, ...patch }),
          printSizesSync: { ...sync, dirtyTypes: addDirty(sync.dirtyTypes, ...changed) },
        })
      },
      setOneSizeOnly(categoryId, on) {
        const { printSizes, printSizesSync: sync } = get()
        return commit({
          printSizes: sanitizePrintSizes({ ...printSizes, oneSizeOnly: { ...printSizes.oneSizeOnly, [categoryId]: on } }),
          printSizesSync: { ...sync, dirtyTypes: addDirty(sync.dirtyTypes, categoryId) },
        })
      },
      setPrintWidth(categoryId, size, widthMm) {
        const { printSizes } = get()
        const row = { ...printSizes.byType[categoryId] }
        if (isValidWidth(widthMm)) row[size ?? ONE_SIZE] = widthMm
        else delete row[size ?? ONE_SIZE]
        const { printSizesSync: sync } = get()
        return commit({
          printSizes: sanitizePrintSizes({ ...printSizes, byType: { ...printSizes.byType, [categoryId]: row } }),
          printSizesSync: { ...sync, dirtyTypes: addDirty(sync.dirtyTypes, categoryId) },
        })
      },
      applyServerPrintSizes(server, pushedTypes) {
        const { printSizes: local, printSizesSync: sync } = get()
        const dirtyTypes = sync.dirtyTypes.filter((c) => !pushedTypes.includes(c))
        const byType = { ...server.byType }
        const oneSizeOnly = { ...server.oneSizeOnly }
        for (const c of dirtyTypes) {
          if (local.byType[c]) byType[c] = local.byType[c]
          else delete byType[c]
          if (local.oneSizeOnly[c]) oneSizeOnly[c] = true
          else delete oneSizeOnly[c]
        }
        return commit({
          printSizes: sanitizePrintSizes({ defaultSize: local.defaultSize, byType, oneSizeOnly }),
          printSizesSync: { ...sync, dirtyTypes },
        })
      },
      setTheme: (theme) => commit({ theme: isThemeChoice(theme) ? theme : 'system' }),
      markPrintSizesImported: () => commit({ printSizesSync: { ...get().printSizesSync, imported: true } }),
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
    printSizesSync: s.printSizesSync,
    theme: s.theme,
    loaded: s.loaded,
  }
}

const addDirty = (list: string[], ...ids: string[]) => [...new Set([...list, ...ids])]

let tauriSettings: ReturnType<typeof createSettingsStore> | undefined
/** Tauri-backed store, created on first use. */
export function getSettingsStore() {
  tauriSettings ??= createSettingsStore(createTauriStore())
  return tauriSettings
}

export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useStore(getSettingsStore(), selector)
}
