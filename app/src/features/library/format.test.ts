import { describe, expect, it } from 'vitest'
import { fileTypes, typeLabel } from './format'

describe('typeLabel', () => {
  it('turns server slugs into words and keeps names written for people', () => {
    expect(typeLabel('t_shirt')).toBe('T shirt')
    expect(typeLabel('sticker')).toBe('Sticker')
    expect(typeLabel('dtf')).toBe('DTF')
    expect(typeLabel('uv_dtf')).toBe('UV DTF')
    expect(typeLabel('mug')).toBe('Mug')
    expect(typeLabel('T-Shirts')).toBe('T-Shirts')
    expect(typeLabel('')).toBe('')
    expect(typeLabel(undefined)).toBe('')
  })

  it("lists an order's different types once each", () => {
    expect(fileTypes([{ productType: 'mug' }, { productType: 't-shirt' }, { productType: 'mug' }, { productType: '' }])).toBe('Mug, T shirt')
  })
})
