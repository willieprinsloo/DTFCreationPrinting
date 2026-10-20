import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINT_SIZES, ONE_SIZE, defaultWidthMm, pickSize, sanitizePrintSizes } from './printSizes'

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

describe('sanitizePrintSizes', () => {
  it('keeps only positive finite widths and a standard default size', () => {
    expect(
      sanitizePrintSizes({ defaultSize: 'XXL', byType: { '3': { M: 280, L: -1, XL: 'x', S: 0, XS: Infinity }, '4': {}, '5': 'bad' } }),
    ).toEqual({ defaultSize: 'M', byType: { '3': { M: 280 } } })
  })
  it('returns the defaults for junk', () => {
    expect(sanitizePrintSizes(undefined)).toEqual(DEFAULT_PRINT_SIZES)
    expect(sanitizePrintSizes('nope')).toEqual(DEFAULT_PRINT_SIZES)
    expect(sanitizePrintSizes({ defaultSize: 'L' })).toEqual({ defaultSize: 'L', byType: {} })
  })
})
