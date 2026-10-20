import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ItemProperties } from './ItemProperties'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import { uiStore } from '../../state/uiStore'
import { fakeClient, withClient } from '../library/testUtils'

const asset = { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 1500 }
const source = { kind: 'local' as const, id: 's', label: 'Logo.png', customerName: 'Jo', orderNumber: 'A12', orderId: 'o1' }
let id = ''

beforeEach(() => {
  const s = getSheetStore().getState()
  s.newSheet(DEFAULT_PROFILE)
  s.addItems([{ asset, source, widthMm: 254, heightMm: 127, quantity: 1 }])
  id = getSheetStore().getState().sheet.items[0].id
})
const item = () => getSheetStore().getState().sheet.items[0]

describe('ItemProperties', () => {
  it('shows dpi and quality label', () => {
    render(<ItemProperties ids={[id]} />)
    expect(screen.getByText('300 dpi')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('Logo.png')).toBeInTheDocument()
    expect(screen.getByText('Jo')).toBeInTheDocument()
  })

  it('keeps aspect when width changes', async () => {
    render(<ItemProperties ids={[id]} />)
    const w = screen.getByLabelText('Width')
    await userEvent.clear(w)
    await userEvent.type(w, '50.8{Enter}')
    expect(item().widthMm).toBeCloseTo(508)
    expect(item().heightMm).toBeCloseTo(254)
  })

  it('rotates by 90 and duplicates / deletes', async () => {
    render(<ItemProperties ids={[id]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }))
    expect(item().rotationDeg).toBe(90)
    await userEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    expect(getSheetStore().getState().sheet.items).toHaveLength(2)
  })

  it('multi-select shows count and only Duplicate/Delete', () => {
    render(<ItemProperties ids={['x', 'y']} />)
    expect(screen.getByText('2 designs selected')).toBeInTheDocument()
    expect(screen.queryByLabelText('Width')).toBeNull()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument()
  })

  it('shows Too low for a 100 dpi item', () => {
    getSheetStore().setState((st) => ({
      sheet: { ...st.sheet, items: st.sheet.items.map((i) => ({ ...i, asset: { ...i.asset, widthPx: 1000, heightPx: 500 } })) },
    }))
    render(<ItemProperties ids={[id]} />)
    expect(screen.getByText('100 dpi')).toBeInTheDocument()
    expect(screen.getByText('Too low')).toBeInTheDocument()
  })

  it('rotate left goes from 0 to 270', async () => {
    render(<ItemProperties ids={[id]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rotate left 90 degrees' }))
    expect(item().rotationDeg).toBe(270)
  })

  it('uses the lower axis for dpi (150 dpi is Low)', () => {
    getSheetStore().getState().updateItem(id, { widthMm: 254, heightMm: 254 })
    render(<ItemProperties ids={[id]} />)
    expect(screen.getByText('150 dpi')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
  })
})

describe('ItemProperties garment size', () => {
  const productSource = { kind: 'gallery' as const, id: 'p1', productId: 'p1', categoryId: '3', size: 'M', sizes: ['S', 'M', 'L'], label: 'Tee — M' }
  const wrapper = withClient(fakeClient({ listProductCategories: vi.fn(async () => [{ id: '3', name: 'T-Shirts' }]) }))
  let pid = ''
  beforeEach(async () => {
    await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { M: 200, L: 300 } } })
    uiStore.getState().setPrintSizeNotice(null)
    const s = getSheetStore().getState()
    s.newSheet(DEFAULT_PROFILE)
    s.addItems([{ asset, source: productSource, widthMm: 200, heightMm: 100, quantity: 1 }])
    pid = getSheetStore().getState().sheet.items[0].id
    getSheetStore().getState().updateItem(pid, { xMm: 50, yMm: 40 })
  })

  it('is not shown for non-product items', () => {
    render(<ItemProperties ids={[id]} />, { wrapper })
    expect(screen.queryByLabelText('Garment size')).toBeNull()
  })

  it('M to L resizes to the table width, keeps centre and aspect, relabels; one undo restores', async () => {
    render(<ItemProperties ids={[pid]} />, { wrapper })
    await userEvent.selectOptions(screen.getByLabelText('Garment size'), 'L')
    const it = getSheetStore().getState().sheet.items[0]
    expect(it.widthMm).toBe(300)
    expect(it.heightMm).toBeCloseTo(150)
    expect(it.xMm + it.widthMm / 2).toBeCloseTo(150)
    expect(it.yMm + it.heightMm / 2).toBeCloseTo(90)
    expect(it.source.size).toBe('L')
    expect(it.source.label).toBe('Tee — L')
    getSheetStore().getState().undo()
    const back = getSheetStore().getState().sheet.items[0]
    expect([back.widthMm, back.xMm, back.source.size, back.source.label]).toEqual([200, 50, 'M', 'Tee — M'])
  })

  it('keeps the width and shows a notice when the size has no default', async () => {
    render(<ItemProperties ids={[pid]} />, { wrapper })
    await userEvent.selectOptions(screen.getByLabelText('Garment size'), 'S')
    expect(getSheetStore().getState().sheet.items[0].widthMm).toBe(200)
    expect(getSheetStore().getState().sheet.items[0].source.size).toBe('S')
    expect(uiStore.getState().printSizeNotice).toMatch(/No default print size for T-Shirts · S/)
  })

  it('Save as default stores the current width and then hides', async () => {
    getSheetStore().getState().resizeItem(pid, 250)
    render(<ItemProperties ids={[pid]} />, { wrapper })
    const btn = await screen.findByRole('button', { name: 'Save as default for T-Shirts · M' })
    await userEvent.click(btn)
    expect(getSettingsStore().getState().printSizes.byType['3'].M).toBe(250)
    expect(screen.queryByRole('button', { name: /Save as default/ })).toBeNull()
  })

  it('hides Save as default when the width already equals the default', async () => {
    render(<ItemProperties ids={[pid]} />, { wrapper })
    await screen.findByText(/Garment size/)
    expect(screen.queryByRole('button', { name: /Save as default/ })).toBeNull()
  })
})
