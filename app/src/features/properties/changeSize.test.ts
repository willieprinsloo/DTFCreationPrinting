import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
import { stepItemSize } from './changeSize'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'

const asset = { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 1500 }
const source = { kind: 'gallery' as const, id: 'p', productId: 'p', categoryId: '3', size: 'M', sizes: ['S', 'M', 'L'], label: 'Tee — M' }
const item = () => getSheetStore().getState().sheet.items[0]

beforeEach(async () => {
  await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { S: 150, M: 200, L: 300 } } })
  const s = getSheetStore().getState()
  s.newSheet(DEFAULT_PROFILE)
  s.addItems([{ asset, source, widthMm: 200, heightMm: 100, quantity: 1 }])
})

describe('stepItemSize', () => {
  it('steps to the next and previous size and stops at the ends', () => {
    stepItemSize(item().id, 1)
    expect([item().source.size, item().widthMm]).toEqual(['L', 300])
    stepItemSize(item().id, 1)
    expect(item().source.size).toBe('L')
    stepItemSize(item().id, -1)
    stepItemSize(item().id, -1)
    expect([item().source.size, item().widthMm]).toEqual(['S', 150])
    stepItemSize(item().id, -1)
    expect(item().source.size).toBe('S')
  })
})
