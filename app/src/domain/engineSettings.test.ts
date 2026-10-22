import { describe, expect, it } from 'vitest'
import { DEFAULT_ENGINE_SETTINGS, MAINTOP_6PASS_PRESET, curveFromThree, curveToThree, isDetailedCurve, sanitizeEngineSettings, validateEngineSettings } from './engineSettings'

const d = DEFAULT_ENGINE_SETTINGS

describe('sanitizeEngineSettings ranges', () => {
  it('keeps values inside the plan ranges', () => {
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 100 }).inkLimitPct).toBe(100)
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 400 }).inkLimitPct).toBe(400)
    expect(sanitizeEngineSettings({ ...d, whiteDensityPct: 0 }).whiteDensityPct).toBe(0)
    expect(sanitizeEngineSettings({ ...d, whiteChokeMm: 2 }).whiteChokeMm).toBe(2)
    expect(sanitizeEngineSettings({ ...d, leadInMm: 1000 }).leadInMm).toBe(1000)
  })

  it('clamps out-of-range saved values to the nearest bound', () => {
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 50 }).inkLimitPct).toBe(100)
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: 900 }).inkLimitPct).toBe(400)
    expect(sanitizeEngineSettings({ ...d, whiteDensityPct: 150 }).whiteDensityPct).toBe(100)
    expect(sanitizeEngineSettings({ ...d, whiteDensityPct: -5 }).whiteDensityPct).toBe(0)
    expect(sanitizeEngineSettings({ ...d, whiteChokeMm: 3 }).whiteChokeMm).toBe(2)
    expect(sanitizeEngineSettings({ ...d, leadInMm: 5000 }).leadInMm).toBe(1000)
    expect(sanitizeEngineSettings({ ...d, leadInMm: -1 }).leadInMm).toBe(0)
  })

  it('gives old profiles normal sliders and clamps the slider values', () => {
    const { darkness: _d, saturationPct: _s, ...old } = d
    expect(sanitizeEngineSettings(old)).toMatchObject({ darkness: 0, saturationPct: 100 })
    expect(sanitizeEngineSettings({ ...d, darkness: 300, saturationPct: 10 })).toMatchObject({ darkness: 100, saturationPct: 50 })
  })

  it('falls back to the default for values that are not numbers', () => {
    expect(sanitizeEngineSettings({ ...d, inkLimitPct: NaN }).inkLimitPct).toBe(d.inkLimitPct)
    expect(sanitizeEngineSettings({ ...d, whiteChokeMm: 'x' }).whiteChokeMm).toBe(d.whiteChokeMm)
  })

  it('moves profiles still on the first, guessed channel order to the measured Y, M, C, K order', () => {
    expect(sanitizeEngineSettings({ ...d, channelOrder: ['K', 'C', 'M', 'Y', 'W', 'W'] }).channelOrder).toEqual(['Y', 'M', 'C', 'K', 'W', 'W'])
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
    expect(validateEngineSettings({ ...d, leadInMm: -1 })).toMatch(/blank film/i)
    expect(validateEngineSettings({ ...d, darkness: 101 })).toMatch(/lighter or darker|lighter \/ darker/i)
    expect(validateEngineSettings({ ...d, saturationPct: 49 })).toMatch(/colour/i)
    expect(validateEngineSettings({ ...d, channelOrder: ['K', 'K', 'M', 'Y', 'W', 'W'] })).toMatch(/each ink/i)
    expect(validateEngineSettings({ ...d, inkLimitPct: NaN })).toMatch(/ink limit/i)
  })

  it('rejects a dot-gain curve that goes backwards', () => {
    const dotGain = { ...d.dotGain, C: [[0.25, 0.4], [0.5, 0.3], [0.75, 0.8]] as [number, number][] }
    expect(validateEngineSettings({ ...d, dotGain })).toMatch(/C curve/i)
  })
})

describe('Maintop 6-pass preset', () => {
  it('passes validation and survives sanitizing', () => {
    expect(validateEngineSettings({ ...d, ...MAINTOP_6PASS_PRESET })).toBeNull()
    expect(sanitizeEngineSettings({ ...d, ...MAINTOP_6PASS_PRESET }).dotGain).toEqual(MAINTOP_6PASS_PRESET.dotGain)
  })
  it('counts only curves the three boxes cannot show as detailed', () => {
    expect(isDetailedCurve(MAINTOP_6PASS_PRESET.dotGain.K)).toBe(true)
    expect(isDetailedCurve([])).toBe(false)
    expect(isDetailedCurve(curveFromThree([30, 55, 80]))).toBe(false)
    expect(isDetailedCurve([[0.5, 0.6]])).toBe(true)
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
