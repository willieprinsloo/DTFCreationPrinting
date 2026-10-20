import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DpiThresholds, PrinterProfile } from '../domain/types'
import { DEFAULT_THRESHOLDS } from '../domain/dpi'
import { createTauriStore, type KeyValueStore } from './persist'

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

export interface SettingsData {
  profiles: PrinterProfile[]
  activeProfileId: string
  thresholds: DpiThresholds
  apiBaseUrl: string
  screenPxPerMm: number
  drawerHeightPx: number
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
}

export type SettingsState = SettingsData & SettingsActions

const SETTINGS_KEY = 'settings'

function defaults(): SettingsData {
  return {
    profiles: [DEFAULT_PROFILE],
    activeProfileId: DEFAULT_PROFILE.id,
    thresholds: { ...DEFAULT_THRESHOLDS },
    apiBaseUrl: 'https://dtfcreations.co.za/api/v1',
    screenPxPerMm: 96 / 25.4,
    drawerHeightPx: 200,
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
