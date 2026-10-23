import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINT_SIZES, ONE_SIZE, defaultWidthMm, estimateWidthMm, pickSize, resolveWidthMm, sanitizePrintSizes } from './printSizes'

describe('pickSize', () => {
  it('returns the preferred size when available (case-insensitive)', () => {
    expect(pickSize(['S', 'M', 'L'], 'M')).toBe('M')
    expect(pickSize(['s', 'm'], 'M')).toBe('m')
  })
  it('falls back to the nearest standard size, larger on a tie', () => {
    expect(pickSize(['L', 'XL'], 'M')).toBe('L')
    expect(pickSize(['S', 'XL'], 'M')).toBe('S')
    expect(pickSize(['S', 'L'], 'M')).toBe('L')
    expect(pickSize(['3XL', 'XS'], 'XL')).toBe('3XL')
  })
  it('falls back to the first size when none is standard', () => {
    expect(pickSize(['Kids', 'Adult'], 'M')).toBe('Kids')
  })
  it('returns null for a product without sizes', () => {
    expect(pickSize([], 'M')).toBeNull()
  })
})

describe('defaultWidthMm', () => {
  const table = { '3': { M: 280, [ONE_SIZE]: 250 }, '4': { [ONE_SIZE]: 90 } }
  it('looks up the width per type and size; null size means One size', () => {
    expect(defaultWidthMm(table, '3', 'M')).toBe(280)
    expect(defaultWidthMm(table, '4', null)).toBe(90)
    expect(defaultWidthMm(table, '3', 'L')).toBeUndefined()
    expect(defaultWidthMm(table, '9', 'M')).toBeUndefined()
  })
})

describe('resolveWidthMm', () => {
  const ps = (row: Record<string, number>, oneSizeOnly = false) => ({ ...DEFAULT_PRINT_SIZES, byType: { tee: row }, oneSizeOnly: { tee: oneSizeOnly } })
  it('uses the one width a type has for every size', () => {
    expect(resolveWidthMm(ps({ [ONE_SIZE]: 280 }), 'tee', 'M')).toBe(280)
    expect(resolveWidthMm(ps({ [ONE_SIZE]: 280 }), 'tee', null)).toBe(280)
    expect(resolveWidthMm(ps({ L: 300 }), 'tee', 'S')).toBe(300)
  })
  it('keeps per-size widths, and leaves a missing size unset when a type has several', () => {
    const several = ps({ S: 240, M: 270, [ONE_SIZE]: 250 })
    expect(resolveWidthMm(several, 'tee', 'S')).toBe(240)
    expect(resolveWidthMm(several, 'tee', 'XL')).toBeUndefined()
    expect(resolveWidthMm(ps({ S: 240, [ONE_SIZE]: 250 }, true), 'tee', 'S')).toBe(250)
    expect(resolveWidthMm(ps({}), 'tee', 'M')).toBeUndefined()
    expect(resolveWidthMm(ps({ M: 270 }), 'mug', 'M')).toBeUndefined()
  })
})

describe('sanitizePrintSizes', () => {
  it('keeps only positive finite widths and a standard default size', () => {
    expect(
      sanitizePrintSizes({ defaultSize: 'XXL', byType: { '3': { M: 280, L: -1, XL: 'x', S: 0, XS: Infinity }, '4': {}, '5': 'bad' } }),
    ).toEqual({ defaultSize: 'M', byType: { '3': { M: 280 } }, oneSizeOnly: {} })
  })
  it('returns the defaults for junk', () => {
    expect(sanitizePrintSizes(undefined)).toEqual(DEFAULT_PRINT_SIZES)
    expect(sanitizePrintSizes('nope')).toEqual(DEFAULT_PRINT_SIZES)
    expect(sanitizePrintSizes({ defaultSize: 'L' })).toEqual({ defaultSize: 'L', byType: {}, oneSizeOnly: {} })
  })
  it('keeps only true oneSizeOnly flags', () => {
    expect(sanitizePrintSizes({ oneSizeOnly: { '3': true, '4': false, '5': 'yes' } }).oneSizeOnly).toEqual({ '3': true })
    expect(sanitizePrintSizes({ oneSizeOnly: 'bad' }).oneSizeOnly).toEqual({})
  })
})

describe('estimateWidthMm', () => {
  it('scales 6 % per standard size step, both ways, any case', () => {
    expect(estimateWidthMm(200, 'M', 'L')).toBe(212)
    expect(estimateWidthMm(200, 'm', 'xl')).toBe(224.7)
    expect(estimateWidthMm(212, 'L', 'M')).toBe(200)
    expect(estimateWidthMm(200, 'M', 'M')).toBe(200)
  })
  it('gives up on non-standard sizes', () => {
    expect(estimateWidthMm(200, 'M', 'Kids 8')).toBeUndefined()
    expect(estimateWidthMm(0, 'M', 'L')).toBeUndefined()
  })
})
