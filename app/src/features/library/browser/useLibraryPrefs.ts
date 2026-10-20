import { useCallback } from 'react'
import { getSettingsStore, useSettings, type LibraryPrefsPatch } from '../../../state/settingsStore'

/** The persisted browser prefs and a merge-and-save updater. */
export function useLibraryPrefs() {
  const prefs = useSettings((s) => s.libraryPrefs)
  const update = useCallback((patch: LibraryPrefsPatch) => {
    getSettingsStore()
      .getState()
      .setLibraryPrefs(patch)
      .catch((err) => console.warn('Could not save library preferences', err))
  }, [])
  return [prefs, update] as const
}
