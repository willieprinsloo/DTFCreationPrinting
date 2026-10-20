import { describe, expect, it } from 'vitest'
import { DEFAULT_ENGINE_SETTINGS, curveFromThree, curveToThree, sanitizeEngineSettings, validateEngineSettings } from './engineSettings'

const d = DEFAULT_ENGINE_SETTINGS

describe('sanitizeEngineSettings ranges', () => {
  it('accepts the plan ranges and repairs values outside them', () => {
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 100 }).inkLimitPct).toBe(100)
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 400 }).inkLimitPct).toBe(400)
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 99 }).inkLimitPct).toBe(d.inkLimitPct)
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 401 }).inkLimitPct).toBe(d.inkLimitPct)
    expect(sanitizeEngineSettings({ ...d, whiteDensityPct: 100 }).whiteDensityPct).toBe(100)
    expect(sanitizeEngineSettings({ ...d, whiteDensityPct: 0 }).whiteDensityPct).toBe(0)
    expect(sanitizeEngineSettings({ ...d, whiteDensityPct: 150 }).whiteDensityPct).toBe(d.whiteDensityPct)
    expect(sanitizeEngineSettings({ ...d, whiteChokeMm: 2 }).whiteChokeMm).toBe(2)
    expect(sanitizeEngineSettings({ ...d, whiteChokeMm: 3 }).whiteChokeMm).toBe(d.whiteChokeMm)
    expect(sanitizeEngineSettings({ ...d, leadInMm: 1000 }).leadInMm).toBe(1000)
    expect(sanitizeEngineSettings({ ...d, leadInMm: 1001 }).leadInMm).toBe(d.leadInMm)
  })

  it('requires the channel order to be a permutation of K, C, M, Y, W, W', () => {
    expect(sanitizeEngineSettings({ ...d, channelOrder: ['W', 'W', 'Y', 'M', 'C', 'K'] }).channelOrder).toEqual(['W', 'W', 'Y', 'M', 'C', 'K'])
    for (const bad of [
      ['K', 'K', 'M', 'Y', 'W', 'W'],
      ['K', 'C', 'M', 'Y', 'W', 'C'],
      ['K', 'C', 'M', 'Y', 'W', 'W', 'W'],
      ['K', 'C', 'M', 'Y', 'W', 'X'],
    ]) {
      expect(sanitizeEngineSettings({ ...d, channelOrder: bad }).channelOrder).toEqual(d.channelOrder)
    }
  })
})

describe('validateEngineSettings', () => {
  it('passes the defaults', () => expect(validateEngineSettings(d)).toBeNull())

  it('explains each out-of-range value in plain words', () => {
    expect(validateEngineSettings({ ...d, inkLimitPct: 50 })).toMatch(/ink limit.*100.*400/i)
    expect(validateEngineSettings({ ...d, whiteDensityPct: 101 })).toMatch(/white density.*0.*100/i)
    expect(validateEngineSettings({ ...d, whiteChokeMm: 2.5 })).toMatch(/choke.*0.*2/i)
    expect(validateEngineSettings({ ...d, leadInMm: -1 })).toMatch(/lead-in/i)
    expect(validateEngineSettings({ ...d, channelOrder: ['K', 'K', 'M', 'Y', 'W', 'W'] })).toMatch(/each ink/i)
    expect(validateEngineSettings({ ...d, inkLimitPct: NaN })).toMatch(/ink limit/i)
  })

  it('rejects a dot-gain curve that goes backwards', () => {
    const dotGain = { ...d.dotGain, C: [[0.25, 0.4], [0.5, 0.3], [0.75, 0.8]] as [number, number][] }
    expect(validateEngineSettings({ ...d, dotGain })).toMatch(/C curve/i)
  })
})

describe('three-point curves', () => {
  it('shows an empty (linear) curve as 25/50/75', () => expect(curveToThree([])).toEqual([25, 50, 75]))
  it('reads the three points back as percentages', () => expect(curveToThree([[0.25, 0.3], [0.5, 0.55], [0.75, 0.8]])).toEqual([30, 55, 80]))
  it('interpolates a curve with other points', () => expect(curveToThree([[0.5, 0.6]])[1]).toBeCloseTo(60))
  it('stores linear as an empty curve and others as 3 points', () => {
    expect(curveFromThree([25, 50, 75])).toEqual([])
    expect(curveFromThree([30, 55, 80])).toEqual([[0.25, 0.3], [0.5, 0.55], [0.75, 0.8]])
  })
})
