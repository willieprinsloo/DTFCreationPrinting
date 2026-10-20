import { describe, expect, it } from 'vitest'
import { InvalidSheetError, findProblems, itemBounds, printableArea, sheetLengthMm, displayLengthMm, heightForWidth, widthForHeight, sizeAfterTransform } from './geometry'
import type { Sheet, SheetItem, SheetSettings } from './types'

const m = (n: number) => ({ topMm: n, rightMm: n, bottomMm: n, leftMm: n })
const settings = (over: Partial<SheetSettings> = {}): SheetSettings => ({
  widthMm: 600, margins: m(5), gapMm: 3, lengthMode: 'auto', fixedLengthMm: 1000,
  mirror: false, whiteEnabled: true, allowRotate: true, ...over,
})
const item = (id: string, over: Partial<SheetItem> = {}): SheetItem => ({
  id,
  asset: { assetId: id, path: 'p', previewPath: 'pp', widthPx: 100, heightPx: 100 },
  source: { kind: 'local', id, label: id },
  xMm: 10, yMm: 10, widthMm: 100, heightMm: 50, rotationDeg: 0, whiteEnabled: true, ...over,
})
const sheet = (items: SheetItem[], s = settings()): Sheet => ({ id: 's', name: 'S', profileId: 'p', settings: s, items })

describe('printableArea', () => {
  it('uses margins and infinite height for auto', () => {
    expect(printableArea(settings())).toEqual({ xMm: 5, yMm: 5, widthMm: 590, heightMm: Infinity })
  })
  it('throws when width is not positive', () => {
    expect(() => printableArea(settings({ margins: { ...m(5), leftMm: 300, rightMm: 300 } }))).toThrow(InvalidSheetError)
  })
})

describe('itemBounds', () => {
  it('returns bbox of a 90 degree rotated item about its centre', () => {
    const b = itemBounds(item('a', { xMm: 0, yMm: 0, widthMm: 100, heightMm: 50, rotationDeg: 90 }))
    expect(b.xMm).toBeCloseTo(25)
    expect(b.yMm).toBeCloseTo(-25)
    expect(b.widthMm).toBeCloseTo(50)
    expect(b.heightMm).toBeCloseTo(100)
  })
  it('is unchanged without rotation', () => {
    expect(itemBounds(item('a'))).toEqual({ xMm: 10, yMm: 10, widthMm: 100, heightMm: 50 })
  })
})

describe('sheetLengthMm', () => {
  it('auto: lowest item bottom plus bottom margin', () => {
    const items = [item('a', { yMm: 70, heightMm: 50 }), item('b', { yMm: 250, heightMm: 50 })]
    expect(sheetLengthMm(sheet(items))).toBe(305)
  })
  it('auto: empty sheet is top + bottom margin', () => {
    expect(sheetLengthMm(sheet([]))).toBe(10)
  })
  it('fixed: uses fixedLengthMm', () => {
    expect(sheetLengthMm(sheet([], settings({ lengthMode: 'fixed', fixedLengthMm: 1000 })))).toBe(1000)
  })
})

describe('findProblems', () => {
  it('ignores touching items', () => {
    const items = [item('a', { xMm: 10 }), item('b', { xMm: 110 })]
    expect(findProblems(sheet(items))).toEqual([])
  })
  it('reports a 1 mm overlap', () => {
    const items = [item('a', { xMm: 10 }), item('b', { xMm: 109 })]
    expect(findProblems(sheet(items))).toEqual([{ kind: 'overlap', itemIds: ['a', 'b'] }])
  })
  it('reports items beyond the right margin', () => {
    expect(findProblems(sheet([item('a', { xMm: 560, widthMm: 40 })]))).toEqual([{ kind: 'outside', itemId: 'a' }])
  })
  it('reports items left of the left margin or above the top margin', () => {
    expect(findProblems(sheet([item('a', { xMm: 2 })]))).toEqual([{ kind: 'outside', itemId: 'a' }])
    expect(findProblems(sheet([item('a', { yMm: 2 })]))).toEqual([{ kind: 'outside', itemId: 'a' }])
  })
})

describe('fixed length overflow', () => {
  const fixed = settings({ lengthMode: 'fixed', fixedLengthMm: 1000 })
  it('flags an item running into the bottom margin', () => {
    const p = findProblems(sheet([item('a', { yMm: 949, heightMm: 50 })], fixed))
    expect(p).toEqual([{ kind: 'outside', itemId: 'a' }])
  })
  it('accepts an item inside the printable area', () => {
    expect(findProblems(sheet([item('a', { yMm: 940, heightMm: 50 })], fixed))).toEqual([])
  })
  it('throws when the fixed length leaves no printable height', () => {
    expect(() => printableArea(settings({ lengthMode: 'fixed', fixedLengthMm: 8 }))).toThrow(InvalidSheetError)
  })
})

describe('displayLengthMm', () => {
  it('auto: empty sheet shows the minimum preview length', () => {
    expect(displayLengthMm(sheet([]), 1000)).toBe(1000)
  })
  it('auto: content longer than the minimum wins', () => {
    expect(displayLengthMm(sheet([item('a', { yMm: 1445, heightMm: 50 })]), 1000)).toBe(1500)
  })
  it('fixed: exactly the fixed length, no minimum', () => {
    expect(displayLengthMm(sheet([], settings({ lengthMode: 'fixed', fixedLengthMm: 800 })), 1000)).toBe(800)
  })
})

describe('aspect helpers', () => {
  const it0 = { asset: { assetId: 'a', path: '', previewPath: '', widthPx: 3000, heightPx: 1500 }, widthMm: 100, heightMm: 80 } as unknown as SheetItem
  it('derive from the asset aspect, not the current item size', () => {
    expect(heightForWidth(it0, 200)).toBe(100)
    expect(widthForHeight(it0, 100)).toBe(200)
  })
  it('sizeAfterTransform uses scaleX and yields the asset aspect', () => {
    const r = sizeAfterTransform(it0, 2)
    expect(r.widthMm).toBe(200)
    expect(r.heightMm).toBe(100)
  })
})
