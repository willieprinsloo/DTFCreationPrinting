import { describe, expect, it } from 'vitest'
import { InvalidSheetError, findProblems, itemBounds, printableArea, sheetLengthMm } from './geometry'
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
