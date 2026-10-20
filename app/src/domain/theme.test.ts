import { describe, expect, it } from 'vitest'
import { effectiveTheme, isThemeChoice } from './theme'
import { createMemoryStore } from '../state/persist'
import { createSettingsStore } from '../state/settingsStore'

describe('theme', () => {
  it('follows the computer only for "system"', () => {
    expect(effectiveTheme('system', true)).toBe('dark')
    expect(effectiveTheme('system', false)).toBe('light')
    expect(effectiveTheme('light', true)).toBe('light')
    expect(effectiveTheme('dark', false)).toBe('dark')
  })

  it('is saved, and a bad saved value falls back to the system', async () => {
    expect(isThemeChoice('dark')).toBe(true)
    expect(isThemeChoice('blue')).toBe(false)
    const kv = createMemoryStore()
    const s = createSettingsStore(kv)
    await s.getState().load()
    expect(s.getState().theme).toBe('system')
    await s.getState().setTheme('dark')
    const again = createSettingsStore(kv)
    await again.getState().load()
    expect(again.getState().theme).toBe('dark')
    await kv.set('settings', { theme: 'blue' })
    await again.getState().load()
    expect(again.getState().theme).toBe('system')
  })
})
