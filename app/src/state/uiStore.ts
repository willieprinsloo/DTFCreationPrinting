import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

export type SettingsTab = 'printers' | 'printer-ink' | 'print-sizes' | 'general'

interface UiState {
  /** Open Settings page, or null when Settings is closed. */
  settingsTab: SettingsTab | null
  /** Non-blocking note after a quick add that had no default print size. */
  printSizeNotice: string | null
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
  setPrintSizeNotice(text: string | null): void
}

/** App-wide UI state that unrelated parts of the window need to reach (e.g. "open Settings › Print sizes"). */
export const uiStore = createStore<UiState>((set) => ({
  settingsTab: null,
  printSizeNotice: null,
  openSettings: (tab = 'printers') => set({ settingsTab: tab }),
  closeSettings: () => set({ settingsTab: null }),
  setPrintSizeNotice: (text) => set({ printSizeNotice: text }),
}))

export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector)
}
