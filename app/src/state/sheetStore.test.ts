import { describe, expect, it } from 'vitest'
import { createSheetStore } from './sheetStore'
import { DEFAULT_PROFILE } from './settingsStore'
import { findProblems, itemBounds, InvalidSheetError } from '../domain/geometry'
import type { Asset, SourceRef } from '../domain/types'

const asset: Asset = { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 1000, heightPx: 500 }
const source: SourceRef = { kind: 'local', id: 's1', label: 'one' }
const mk = (quantity = 1, widthMm = 100, heightMm = 50) => ({ asset, source, widthMm, heightMm, quantity })

function fresh() {
  const store = createSheetStore()
  store.getState().newSheet(DEFAULT_PROFILE)
  return store
}

describe('sheetStore', () => {
  it('newSheet takes settings from the profile', () => {
    const { sheet } = fresh().getState()
    expect(sheet.settings.widthMm).toBe(600)
    expect(sheet.settings.margins).toEqual(DEFAULT_PROFILE.defaultMargins)
    expect(sheet.settings.margins.leftMm).toBe(5)
    expect(sheet.settings.gapMm).toBe(3)
    expect(sheet.settings.lengthMode).toBe('auto')
    expect(sheet.settings.fixedLengthMm).toBe(1000)
    expect(sheet.settings.mirror).toBe(true)
    expect(sheet.settings.whiteEnabled).toBe(true)
    expect(sheet.settings.allowRotate).toBe(true)
    expect(sheet.profileId).toBe(DEFAULT_PROFILE.id)
  })

  it('addItems with quantity creates non-overlapping items', () => {
    const store = fresh()
    store.getState().addItems([mk(3)])
    const { sheet } = store.getState()
    expect(sheet.items).toHaveLength(3)
    expect(new Set(sheet.items.map((i) => i.id)).size).toBe(3)
    expect(findProblems(sheet)).toEqual([])
  })

  it('a second addItems places new items below existing content', () => {
    const store = fresh()
    store.getState().addItems([mk(2)])
    const first = store.getState().sheet.items
    const lowest = Math.max(...first.map((i) => itemBounds(i).yMm + itemBounds(i).heightMm))
    store.getState().addItems([mk(2)])
    const { sheet } = store.getState()
    expect(sheet.items).toHaveLength(4)
    expect(sheet.items.slice(0, 2)).toEqual(first)
    for (const it of sheet.items.slice(2)) expect(itemBounds(it).yMm).toBeGreaterThanOrEqual(lowest)
    expect(findProblems(sheet)).toEqual([])
  })

  it('fixed-length sheets place new items just below existing content', () => {
    const store = fresh()
    store.getState().setSettings({ lengthMode: 'fixed', fixedLengthMm: 1000 })
    store.getState().addItems([mk(1, 100, 100)]) // occupies y 5..105
    store.getState().addItems([mk(2, 100, 50)])
    const { sheet } = store.getState()
    const ys = sheet.items.slice(1).map((i) => itemBounds(i).yMm)
    expect(Math.min(...ys)).toBeCloseTo(105 + sheet.settings.gapMm)
    expect(findProblems(sheet)).toEqual([])
  })

  it('rotated placements keep the footprint after conversion', () => {
    const store = createSheetStore()
    store.getState().newSheet({ ...DEFAULT_PROFILE, widthMm: 70 }) // printable 60: only fits rotated
    store.getState().addItems([mk(1, 100, 50)])
    // 100 wide does not fit 60 -> rotated to 50x100 fits
    const [it] = store.getState().sheet.items
    expect(it.rotationDeg).toBe(90)
    const b = itemBounds(it)
    expect(b.widthMm).toBeCloseTo(50)
    expect(b.heightMm).toBeCloseTo(100)
    expect(b.xMm).toBeCloseTo(5)
    expect(b.yMm).toBeCloseTo(5)
    expect(findProblems(store.getState().sheet)).toEqual([])
  })

  it('unplaceable items are added at the left margin and flagged outside', () => {
    const store = fresh()
    store.getState().addItems([mk(1, 900, 900)])
    const { sheet } = store.getState()
    expect(sheet.items).toHaveLength(1)
    expect(sheet.items[0].xMm).toBe(5)
    expect(findProblems(sheet)).toEqual([{ kind: 'outside', itemId: sheet.items[0].id }])
  })

  it('resizeItem keeps aspect by default', () => {
    const store = fresh()
    store.getState().addItems([mk(1, 100, 50)])
    const id = store.getState().sheet.items[0].id
    store.getState().resizeItem(id, 200)
    const it = store.getState().sheet.items[0]
    expect([it.widthMm, it.heightMm]).toEqual([200, 100])
    store.getState().resizeItem(id, 50, false)
    expect([store.getState().sheet.items[0].widthMm, store.getState().sheet.items[0].heightMm]).toEqual([50, 100])
  })

  it('setSettings throws on invalid margins and leaves state unchanged', () => {
    const store = fresh()
    const before = store.getState().sheet
    const m = before.settings.margins
    expect(() => store.getState().setSettings({ margins: { ...m, leftMm: 300, rightMm: 300 } })).toThrow(InvalidSheetError)
    expect(store.getState().sheet).toBe(before)
    store.getState().setSettings({ gapMm: 10 })
    expect(store.getState().sheet.settings.gapMm).toBe(10)
  })

  it('autoPlaceAll repacks all items without problems', () => {
    const store = fresh()
    store.getState().addItems([mk(4, 150, 80)])
    for (const it of store.getState().sheet.items) store.getState().updateItem(it.id, { xMm: 10, yMm: 10 })
    store.getState().autoPlaceAll()
    expect(findProblems(store.getState().sheet)).toEqual([])
  })

  it('removeItems and duplicateItems', () => {
    const store = fresh()
    store.getState().addItems([mk(2)])
    const [a, b] = store.getState().sheet.items
    store.getState().duplicateItems([a.id])
    const { sheet, selectedIds } = store.getState()
    expect(sheet.items).toHaveLength(3)
    const copy = sheet.items[2]
    expect(copy.id).not.toBe(a.id)
    expect(copy.xMm).toBe(a.xMm + 10)
    expect(copy.yMm).toBe(a.yMm + 10)
    expect(selectedIds).toEqual([copy.id])
    store.getState().select([b.id])
    store.getState().removeItems([b.id])
    expect(store.getState().sheet.items.map((i) => i.id)).toEqual([a.id, copy.id])
    expect(store.getState().selectedIds).toEqual([])
  })

  it('undo/redo restore updateItem; select is not an undo step', () => {
    const store = fresh()
    store.getState().addItems([mk(1)])
    const it = store.getState().sheet.items[0]
    store.getState().updateItem(it.id, { xMm: 123 })
    store.getState().select([it.id])
    store.getState().select([])
    store.getState().undo()
    expect(store.getState().sheet.items[0].xMm).toBe(it.xMm)
    store.getState().redo()
    expect(store.getState().sheet.items[0].xMm).toBe(123)
  })

  it('updateItems applies all patches as one undo step', () => {
    const store = fresh()
    store.getState().addItems([mk(2)])
    const [a, b] = store.getState().sheet.items
    store.getState().updateItems([
      { id: a.id, patch: { xMm: 200, yMm: 300 } },
      { id: b.id, patch: { xMm: 250, rotationDeg: 90 } },
    ])
    const [a2, b2] = store.getState().sheet.items
    expect([a2.xMm, a2.yMm, b2.xMm, b2.rotationDeg]).toEqual([200, 300, 250, 90])
    store.getState().undo()
    const [a3, b3] = store.getState().sheet.items
    expect(a3).toEqual(a)
    expect(b3).toEqual(b)
  })

  it('loadSheet clears history', () => {
    const store = fresh()
    store.getState().addItems([mk(1)])
    const sheet = store.getState().sheet
    store.getState().loadSheet(sheet)
    store.getState().undo()
    expect(store.getState().sheet).toBe(sheet)
  })

  describe('applyProfile', () => {
    const narrow = { ...DEFAULT_PROFILE, id: 'dtf-30', widthMm: 300, defaultGapMm: 2, defaultMargins: { topMm: 1, rightMm: 2, bottomMm: 3, leftMm: 4 } }

    it('updates profileId and settings in one undo step', () => {
      const store = fresh()
      store.getState().applyProfile(narrow)
      const { sheet } = store.getState()
      expect(sheet.profileId).toBe('dtf-30')
      expect(sheet.settings.widthMm).toBe(300)
      expect(sheet.settings.margins).toEqual(narrow.defaultMargins)
      expect(sheet.settings.gapMm).toBe(2)
      store.getState().undo()
      expect(store.getState().sheet.profileId).toBe(DEFAULT_PROFILE.id)
      expect(store.getState().sheet.settings.widthMm).toBe(600)
    })

    it('throws and leaves state unchanged when no printable width remains', () => {
      const store = fresh()
      const before = store.getState().sheet
      expect(() => store.getState().applyProfile({ ...narrow, widthMm: 5 })).toThrow(InvalidSheetError)
      expect(store.getState().sheet).toBe(before)
    })
  })
})

describe('setItemSize', () => {
  it('resizes about the centre, relabels, and undoes in one step', () => {
    const store = fresh()
    const s = store.getState()
    s.addItems([{ ...mk(1, 200, 100), source: { kind: 'gallery', id: 'p', label: 'Tee — M', size: 'M', sizes: ['M', 'L'] } }])
    const id = store.getState().sheet.items[0].id
    const before = store.getState().sheet.items[0]
    store.getState().setItemSize(id, 'L', 300)
    const it = store.getState().sheet.items[0]
    expect([it.widthMm, it.heightMm, it.source.size, it.source.label]).toEqual([300, 150, 'L', 'Tee — L'])
    expect(it.xMm + 150).toBeCloseTo(before.xMm + 100)
    expect(it.yMm + 75).toBeCloseTo(before.yMm + 50)
    store.getState().undo()
    expect(store.getState().sheet.items[0]).toEqual(before)
  })
})
