import { describe, it, expect } from 'vitest'
import { createMemoryStore } from './persist'
import { createSettingsStore, DEFAULT_LIBRARY_PREFS, DEFAULT_PROFILE } from './settingsStore'

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

  it('clamps and persists the drawer height', async () => {
    const kv = createMemoryStore()
    const a = createSettingsStore(kv)
    await a.getState().load()
    expect(a.getState().drawerHeightPx).toBe(200)
    await a.getState().setDrawerHeight(50)
    expect(a.getState().drawerHeightPx).toBe(120)
    await a.getState().setDrawerHeight(900)
    expect(a.getState().drawerHeightPx).toBe(480)
    await a.getState().setDrawerHeight(300)
    const b = createSettingsStore(kv)
    await b.getState().load()
    expect(b.getState().drawerHeightPx).toBe(300)
  })
})

describe('settingsStore recent sheets and PRN folder', () => {
  it('keeps recent sheets most-recent-first, de-duplicated, max 20, persisted', async () => {
    const kv = createMemoryStore()
    const a = createSettingsStore(kv)
    await a.getState().load()
    for (let i = 0; i < 25; i++) await a.getState().addRecentSheet(`/s/${i}.dtfsheet`)
    await a.getState().addRecentSheet('/s/10.dtfsheet')
    const list = a.getState().recentSheets
    expect(list).toHaveLength(20)
    expect(list[0]).toBe('/s/10.dtfsheet')
    expect(list.filter((p) => p === '/s/10.dtfsheet')).toHaveLength(1)
    expect(list[1]).toBe('/s/24.dtfsheet')
    await a.getState().setLastPrnFolder('/out')
    const b = createSettingsStore(kv)
    await b.getState().load()
    expect(b.getState().recentSheets).toEqual(list)
    expect(b.getState().lastPrnFolder).toBe('/out')
  })
})

describe('settingsStore minPreviewLengthMm', () => {
  it('defaults to 1000, clamps to at least 100, and persists', async () => {
    const kv = createMemoryStore()
    const a = createSettingsStore(kv)
    await a.getState().load()
    expect(a.getState().minPreviewLengthMm).toBe(1000)
    await a.getState().setMinPreviewLength(10)
    expect(a.getState().minPreviewLengthMm).toBe(100)
    await a.getState().setMinPreviewLength(1500)
    const b = createSettingsStore(kv)
    await b.getState().load()
    expect(b.getState().minPreviewLengthMm).toBe(1500)
  })
})

describe('settingsStore libraryPrefs', () => {
  it('defaults, merges patches per tab, and round-trips through persistence', async () => {
    const kv = createMemoryStore()
    const a = createSettingsStore(kv)
    await a.getState().load()
    expect(a.getState().libraryPrefs).toEqual(DEFAULT_LIBRARY_PREFS)
    expect(DEFAULT_LIBRARY_PREFS.pageSize).toBe(50)
    await a.getState().setLibraryPrefs({ view: 'list', pageSize: 100, orders: { date: '7d' } })
    expect(a.getState().libraryPrefs.orders).toEqual({ ...DEFAULT_LIBRARY_PREFS.orders, date: '7d' })
    const b = createSettingsStore(kv)
    await b.getState().load()
    expect(b.getState().libraryPrefs).toMatchObject({ view: 'list', pageSize: 100, orders: { date: '7d', status: 'confirmed' } })
  })

  it('fills fields missing from older saved prefs with defaults', async () => {
    const kv = createMemoryStore()
    await kv.set('settings', { libraryPrefs: { view: 'list', products: { status: 'draft' } } })
    const s = createSettingsStore(kv)
    await s.getState().load()
    expect(s.getState().libraryPrefs.view).toBe('list')
    expect(s.getState().libraryPrefs.products).toEqual({ ...DEFAULT_LIBRARY_PREFS.products, status: 'draft' })
    expect(s.getState().libraryPrefs.designs).toEqual(DEFAULT_LIBRARY_PREFS.designs)
  })
})

describe('settingsStore printSizes', () => {
  it('defaults to M with an empty table; set/clear widths persist', async () => {
    const kv = createMemoryStore()
    const a = createSettingsStore(kv)
    await a.getState().load()
    expect(a.getState().printSizes).toEqual({ defaultSize: 'M', byType: {}, oneSizeOnly: {} })
    await a.getState().setPrintWidth('3', 'M', 280)
    await a.getState().setPrintWidth('3', null, 250)
    await a.getState().setPrintWidth('4', 'L', 300)
    await a.getState().setPrintWidth('4', 'L', null)
    await a.getState().setPrintSizes({ defaultSize: 'L' })
    await a.getState().setOneSizeOnly('3', true)
    await a.getState().setOneSizeOnly('4', true)
    await a.getState().setOneSizeOnly('4', false)
    const b = createSettingsStore(kv)
    await b.getState().load()
    expect(b.getState().printSizes).toEqual({ defaultSize: 'L', byType: { '3': { M: 280, 'One size': 250 } }, oneSizeOnly: { '3': true } })
  })

  it('ignores non-positive widths and repairs bad saved data', async () => {
    const kv = createMemoryStore()
    await kv.set('settings', { printSizes: { defaultSize: 'huge', byType: { '3': { M: -5, L: 300 } } } })
    const s = createSettingsStore(kv)
    await s.getState().load()
    expect(s.getState().printSizes).toEqual({ defaultSize: 'M', byType: { '3': { L: 300 } }, oneSizeOnly: {} })
    await s.getState().setPrintWidth('3', 'S', 0)
    await s.getState().setPrintWidth('3', 'XL', Number.NaN)
    expect(s.getState().printSizes.byType['3']).toEqual({ L: 300 })
  })

  describe('printer engine settings', () => {
    const LINEAR = { K: [], C: [], M: [], Y: [], W: [] }

    it('the default profile carries the engine defaults', () => {
      expect(DEFAULT_PROFILE).toMatchObject({
        channelOrder: ['Y', 'M', 'C', 'K', 'W', 'W'],
        inkLimitPct: 280,
        whiteDensityPct: 100,
        whiteChokeMm: 0.2,
        screening: 'blueNoise',
        dotGain: LINEAR,
        leadInMm: 0,
      })
      expect(DEFAULT_PROFILE.iccProfilePath).toBeUndefined()
    })

    it('gives profiles saved before engine settings existed the defaults', async () => {
      const kv = createMemoryStore()
      const old = { id: 'old', name: 'Old', widthMm: 600, xDpi: 720, yDpi: 1800, defaultMargins: { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 }, defaultGapMm: 3 }
      await kv.set('settings', { profiles: [old], activeProfileId: 'old' })
      const s = createSettingsStore(kv)
      await s.getState().load()
      expect(s.getState().profiles[0]).toEqual({ ...DEFAULT_PROFILE, ...old })
    })

    it('repairs bad saved engine values and keeps good ones', async () => {
      const kv = createMemoryStore()
      await kv.set('settings', {
        profiles: [{
          ...DEFAULT_PROFILE,
          channelOrder: ['K', 'C', 'M'],
          inkLimitPct: -1,
          whiteDensityPct: 80,
          whiteChokeMm: 'x',
          screening: 'dither',
          dotGain: { K: [[0.5, 0.45]], C: 'bad', M: [[2, 0]] },
          leadInMm: 3,
          iccProfilePath: '  ',
        }],
      })
      const s = createSettingsStore(kv)
      await s.getState().load()
      const p = s.getState().profiles[0]
      expect(p.channelOrder).toEqual(['Y', 'M', 'C', 'K', 'W', 'W'])
      expect(p.inkLimitPct).toBe(100) // out of range: clamped to the nearest bound
      expect(p.whiteDensityPct).toBe(80)
      expect(p.whiteChokeMm).toBe(0.2)
      expect(p.screening).toBe('blueNoise')
      expect(p.dotGain).toEqual({ ...LINEAR, K: [[0.5, 0.45]] })
      expect(p.leadInMm).toBe(3)
      expect(p.iccProfilePath).toBeUndefined()
    })

    it('sanitises upserted profiles too', async () => {
      const s = createSettingsStore(createMemoryStore())
      await s.getState().load()
      await s.getState().upsertProfile({ ...DEFAULT_PROFILE, id: 'x', screening: 'errorDiffusion', inkLimitPct: Number.NaN })
      const p = s.getState().profiles.find((q) => q.id === 'x')!
      expect(p.screening).toBe('errorDiffusion')
      expect(p.inkLimitPct).toBe(280)
    })
  })
})
