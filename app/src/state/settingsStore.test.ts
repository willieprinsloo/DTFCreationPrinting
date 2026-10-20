import { describe, it, expect } from 'vitest'
import { createMemoryStore } from './persist'
import { createSettingsStore, DEFAULT_PROFILE } from './settingsStore'

describe('settingsStore', () => {
  it('loads defaults on a fresh store', async () => {
    const s = createSettingsStore(createMemoryStore())
    await s.getState().load()
    const st = s.getState()
    expect(st.loaded).toBe(true)
    expect(st.profiles).toHaveLength(1)
    const p = st.profiles[0]
    expect(p).toEqual(DEFAULT_PROFILE)
    expect(p.name).toBe('DTF 60 cm')
    expect(p.widthMm).toBe(600)
    expect(p.xDpi).toBe(720)
    expect(p.yDpi).toBe(1800)
    expect(p.defaultMargins).toEqual({ topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 })
    expect(p.defaultGapMm).toBe(3)
    expect(st.activeProfileId).toBe('dtf-60')
    expect(st.thresholds).toEqual({ fine: 200, low: 150 })
    expect(st.apiBaseUrl).toBe('https://dtfcreations.co.za/api/v1')
    expect(st.screenPxPerMm).toBeCloseTo(96 / 25.4)
  })

  it('persists upserted profiles across stores', async () => {
    const kv = createMemoryStore()
    const a = createSettingsStore(kv)
    await a.getState().load()
    await a.getState().upsertProfile({ ...DEFAULT_PROFILE, id: 'wide', name: 'Wide', widthMm: 900 })
    const b = createSettingsStore(kv)
    await b.getState().load()
    expect(b.getState().profiles.map((p) => p.id)).toEqual(['dtf-60', 'wide'])
    await b.getState().setActiveProfile('wide')
    await b.getState().setApiBaseUrl('http://x/api')
    const c = createSettingsStore(kv)
    await c.getState().load()
    expect(c.getState().activeProfileId).toBe('wide')
    expect(c.getState().apiBaseUrl).toBe('http://x/api')
  })

  it('upsert replaces an existing profile by id', async () => {
    const s = createSettingsStore(createMemoryStore())
    await s.getState().load()
    await s.getState().upsertProfile({ ...DEFAULT_PROFILE, widthMm: 610 })
    expect(s.getState().profiles).toHaveLength(1)
    expect(s.getState().profiles[0].widthMm).toBe(610)
  })

  it('refuses to remove the last profile', async () => {
    const s = createSettingsStore(createMemoryStore())
    await s.getState().load()
    await s.getState().removeProfile('dtf-60')
    expect(s.getState().profiles).toHaveLength(1)
  })

  it('removing the active profile falls back to another', async () => {
    const s = createSettingsStore(createMemoryStore())
    await s.getState().load()
    await s.getState().upsertProfile({ ...DEFAULT_PROFILE, id: 'b', name: 'B' })
    await s.getState().setActiveProfile('b')
    await s.getState().removeProfile('b')
    expect(s.getState().activeProfileId).toBe('dtf-60')
  })

  it('rejects thresholds where low >= fine and leaves state unchanged', async () => {
    const s = createSettingsStore(createMemoryStore())
    await s.getState().load()
    expect(() => s.getState().setThresholds({ fine: 150, low: 200 })).toThrow()
    expect(s.getState().thresholds).toEqual({ fine: 200, low: 150 })
    await s.getState().setThresholds({ fine: 300, low: 100 })
    expect(s.getState().thresholds).toEqual({ fine: 300, low: 100 })
  })
})
