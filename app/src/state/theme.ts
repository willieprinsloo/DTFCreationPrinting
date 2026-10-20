import { useSyncExternalStore } from 'react'
import { getSettingsStore } from './settingsStore'
import { effectiveTheme, type Theme, type ThemeChoice } from '../domain/theme'

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)

/** Sets `data-theme` on <html> (tokens.css reads it) and the window's title bar. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(choice === 'system' ? null : choice))
    .catch(() => {}) // Not in Tauri (tests / browser preview).
}

let installed = false
/**
 * Keeps <html> in step with the setting. Runs from the settings store subscription, so the new
 * colours are in place before React re-renders anything that reads them (the canvas).
 */
export function installTheme() {
  if (installed) return
  installed = true
  const settings = getSettingsStore()
  applyTheme(settings.getState().theme)
  settings.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme)
  })
}

function subscribe(onChange: () => void) {
  const q = darkQuery()
  q?.addEventListener('change', onChange)
  const unsubscribe = getSettingsStore().subscribe((s, prev) => {
    if (s.theme !== prev.theme) onChange()
  })
  return () => {
    q?.removeEventListener('change', onChange)
    unsubscribe()
  }
}

/** The theme in use now; components that paint with CSS colours (canvas) re-read them when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => effectiveTheme(getSettingsStore().getState().theme, darkQuery()?.matches ?? false))
}
