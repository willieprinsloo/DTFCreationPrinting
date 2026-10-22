import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../platform/tauri', () => ({ thumbSrc: (u: string) => u, cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
import { LibraryDrawer } from '../LibraryDrawer'
import { fakeClient, withClient } from '../testUtils'
import { DEFAULT_LIBRARY_PREFS, DEFAULT_PROFILE, getSettingsStore } from '../../../state/settingsStore'
import { getSheetStore } from '../../../state/sheetStore'
import { getViewportStore } from '../../canvas/useViewport'
import { cacheAsset } from '../../../platform/tauri'
import type { DtfClient } from '../../../api/dtfClient'
import { uiStore } from '../../../state/uiStore'

const page = <T,>(items: T[]) => vi.fn(async () => ({ items, total: items.length, page: 1, hasNext: false }))
const design = (id: string, name: string) => ({ id, name, imageUrl: `/u/${id}.png`, designType: 'sticker', galleryCategoryId: 'c', tags: [] })
const product = (id: string, name: string) => ({ id, name, categoryId: '3', sizes: ['S'], thumbnailUrl: `/u/${id}.png` })
const order = { id: 'o1', orderNumber: '#1042', status: 'confirmed', customerName: 'Acme', createdAt: '2026-10-19T10:00:00' }

function open(client: DtfClient) {
  render(<LibraryDrawer collapsed={false} onToggleCollapsed={() => {}} />, { wrapper: withClient(client) })
}
async function popOut() {
  await userEvent.click(screen.getByRole('button', { name: /Pop out/ }))
  return screen.getByRole('dialog', { name: 'Library browser' })
}
async function showTab(dlg: HTMLElement, name: string) {
  await userEvent.click(within(dlg).getByRole('tab', { name }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  await getSettingsStore().getState().setLibraryPrefs(DEFAULT_LIBRARY_PREFS)
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
})
afterEach(() => vi.useRealTimers())

describe('LibraryBrowser', () => {
  it('opens from the Pop out button on the drawer tab, closes on Esc and ✕', async () => {
    open(fakeClient())
    await userEvent.click(screen.getByRole('tab', { name: 'Designs' }))
    const dlg = await popOut()
    expect(within(dlg).getByRole('tab', { name: 'Designs' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dlg).getByLabelText('Search designs')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Library browser' })).toBeNull()
    await popOut()
    await userEvent.click(screen.getByRole('button', { name: 'Close library browser' }))
    expect(screen.queryByRole('dialog', { name: 'Library browser' })).toBeNull()
  })

  it('opens with ⌘F and Ctrl+F', async () => {
    open(fakeClient())
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(screen.getByRole('dialog', { name: 'Library browser' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Library browser' })).toBeInTheDocument()
  })

  it('ignores ⌘F while a dialog is open', () => {
    open(fakeClient())
    const dialog = document.createElement('div')
    dialog.className = 'dialog'
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(screen.queryByRole('dialog', { name: 'Library browser' })).toBeNull()
    dialog.remove()
  })

  it('asks for designs newest first', async () => {
    const client = fakeClient()
    open(client)
    await showTab(await popOut(), 'Designs')
    await waitFor(() => expect(client.listGalleryDesigns).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'created_at', order: 'desc', limit: 50 })))
  })

  it('orders: "Last 7 days" sends date_from 7 days ago, Status maps to one request per status, newest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 20, 15, 0))
    const client = fakeClient()
    open(client)
    const dlg = await popOut()
    await showTab(dlg, 'Gang sheets')
    await waitFor(() =>
      expect(client.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'confirmed', sort: 'created_at', order: 'desc', limit: 50 })),
    )
    await userEvent.selectOptions(within(dlg).getByLabelText('Date'), '7d')
    await waitFor(() => expect(client.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: new Date(2026, 9, 13).toISOString() })))
    vi.mocked(client.listOrders).mockClear()
    await userEvent.selectOptions(within(dlg).getByLabelText('Status'), 'both')
    await waitFor(() => expect(client.listOrders).toHaveBeenCalledTimes(2))
    expect(vi.mocked(client.listOrders).mock.calls.map((c) => c[0].status).sort()).toEqual(['confirmed', 'in_production'])
    expect(within(dlg).getByText(/Filtered by Status: Confirmed \+ in production · Date: Last 7 days/)).toBeInTheDocument()
  })

  it('orders: untick-all on the page deselects without fetching files', async () => {
    const getOrderFiles = vi.fn(async () => [{ itemId: 'i1', printFileUrl: '/u/a.png', productType: 'g', sizeLabel: 'A4' }])
    open(fakeClient({ listOrders: page([order]), getOrderFiles }))
    const dlg = await popOut()
    await showTab(dlg, 'Gang sheets')
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: '#1042 Acme' }))
    expect(await within(dlg).findByText('1 selected')).toBeInTheDocument()
    getOrderFiles.mockClear()
    getOrderFiles.mockImplementation(() => new Promise<never>(() => {}))
    await userEvent.click(within(dlg).getByLabelText('Select all on page'))
    await waitFor(() => expect(within(dlg).queryByText('1 selected')).toBeNull())
    expect(getOrderFiles).not.toHaveBeenCalled()
  })

  it('orders search placeholder names the searchable fields', async () => {
    open(fakeClient())
    const dlg = await popOut()
    await showTab(dlg, 'Gang sheets')
    expect(within(dlg).getByLabelText('Search orders')).toHaveAttribute('placeholder', 'Order no. or delivery name')
  })

  it('renders with corrupted saved prefs by falling back to defaults', async () => {
    await getSettingsStore().getState().setLibraryPrefs({ view: 'bogus', pageSize: 7, orders: { status: 'nope', date: 'x', sort: 'y' }, products: { sort: 'z' } } as never)
    expect(getSettingsStore().getState().libraryPrefs).toEqual(DEFAULT_LIBRARY_PREFS)
    open(fakeClient({ listProducts: page([product('p1', 'Tee')]) }))
    const dlg = await popOut()
    expect(await within(dlg).findByRole('checkbox', { name: 'Tee' })).toBeInTheDocument()
  })

  it('products: Status Live maps to active; Clear filters resets and persists', async () => {
    const client = fakeClient({ listProductCategories: vi.fn(async () => [{ id: '3', name: 'T-Shirts' }]) })
    open(client)
    const dlg = await popOut()
    await within(dlg).findByRole('option', { name: 'T-Shirts' })
    await userEvent.selectOptions(within(dlg).getByLabelText('Status'), 'active')
    await waitFor(() => expect(client.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' })))
    await userEvent.selectOptions(within(dlg).getByLabelText('Type'), '3')
    expect(within(dlg).getByText('Filtered by Type: T-Shirts · Status: Live')).toBeInTheDocument()
    expect(within(dlg).getByText('No products match these filters.')).toBeInTheDocument()
    expect(getSettingsStore().getState().libraryPrefs.products).toMatchObject({ status: 'active', categoryId: '3' })
    await userEvent.click(within(dlg).getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(client.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined, categoryId: undefined })))
    expect(getSettingsStore().getState().libraryPrefs.products).toMatchObject({ status: '', categoryId: '' })
    expect(within(dlg).getByText('No products yet.')).toBeInTheDocument()
  })

  it('header checkbox selects every row on the page (list view)', async () => {
    open(fakeClient({ listProducts: page([product('p1', 'Tee'), product('p2', 'Cap')]) }))
    const dlg = await popOut()
    await userEvent.click(within(dlg).getByRole('button', { name: 'List view' }))
    expect(getSettingsStore().getState().libraryPrefs.view).toBe('list')
    await within(dlg).findByRole('cell', { name: 'Tee' })
    await userEvent.click(within(dlg).getByLabelText('Select all on page'))
    expect(within(dlg).getByText('2 selected')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Add 2 to sheet' })).toBeEnabled()
  })

  it('ticking an order selects all its files; Add adds them, closes and resets the canvas view', async () => {
    vi.mocked(cacheAsset).mockResolvedValue({ assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 300, heightPx: 300 })
    const autoView = vi.spyOn(getViewportStore().getState(), 'autoView')
    const client = fakeClient({
      listOrders: page([order]),
      getOrderFiles: vi.fn(async () => [
        { itemId: 'i1', printFileUrl: '/u/a.png', productType: 'g', sizeLabel: 'A4' },
        { itemId: 'i2', printFileUrl: '/u/b.png', productType: 'g', sizeLabel: 'A3' },
      ]),
    })
    open(client)
    const dlg = await popOut()
    await showTab(dlg, 'Gang sheets')
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: '#1042 Acme' }))
    expect(await within(dlg).findByText('2 selected')).toBeInTheDocument()
    expect(within(dlg).getByRole('checkbox', { name: '#1042 Acme' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Files of #1042' }))
    expect(within(dlg).getByRole('checkbox', { name: '#1042 A4' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add 2 to sheet' }))
    await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Library browser' })).toBeNull())
    expect(autoView).toHaveBeenCalled()
  })

  it('keyboard: ↓ moves focus, Space toggles, ⌘A selects the page, Enter opens the add dialog', async () => {
    open(fakeClient({ listGalleryDesigns: page([design('d1', 'Lion'), design('d2', 'Tiger')]) }))
    const dlg = await popOut()
    await showTab(dlg, 'Designs')
    await within(dlg).findByRole('checkbox', { name: 'Lion' })
    await userEvent.keyboard('{ArrowDown}')
    expect(within(dlg).getByRole('checkbox', { name: 'Lion' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(within(dlg).getByRole('checkbox', { name: 'Tiger' })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(within(dlg).getByText('1 selected')).toBeInTheDocument()
    await userEvent.keyboard('{Meta>}a{/Meta}')
    expect(within(dlg).getByText('2 selected')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Add Tiger' })).toBeInTheDocument()
  })

  it('clicking the backdrop keeps the panel open', async () => {
    open(fakeClient())
    const dlg = await popOut()
    await userEvent.click(dlg.parentElement!)
    expect(screen.getByRole('dialog', { name: 'Library browser' })).toBeInTheDocument()
  })

  it('shows order statuses in plain English', async () => {
    const odd = { ...order, id: 'o2', orderNumber: '#2', status: 'ready_to_ship' }
    open(fakeClient({ listOrders: page([order, { ...odd, id: 'o3', orderNumber: '#3', status: 'in_production' }, odd]) }))
    const dlg = await popOut()
    await userEvent.click(within(dlg).getByRole('button', { name: 'List view' }))
    await showTab(dlg, 'Gang sheets')
    expect(await within(dlg).findByRole('cell', { name: 'Confirmed' })).toBeInTheDocument()
    expect(within(dlg).getByRole('cell', { name: 'In production' })).toBeInTheDocument()
    expect(within(dlg).getByRole('cell', { name: 'Ready to ship' })).toBeInTheDocument()
  })

  it('counts selected items that are not in the current view', async () => {
    const list = vi.fn(async (q: { search?: string }) => {
      const items = [product('p1', 'Tee'), product('p2', 'Cap')].filter((p) => !q.search || p.name.toLowerCase().includes(q.search))
      return { items, total: items.length, page: 1, hasNext: false }
    })
    open(fakeClient({ listProducts: list }))
    const dlg = await popOut()
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cap' }))
    expect(within(dlg).getByText('2 selected')).toBeInTheDocument()
    await userEvent.type(within(dlg).getByLabelText('Search products'), 'tee')
    expect(await within(dlg).findByText('2 selected (1 not shown)')).toBeInTheDocument()
  })

  it('ticking an order decides select/deselect from the latest selection, not the click-time one', async () => {
    const client = fakeClient({
      listOrders: page([order]),
      getOrderFiles: vi.fn(async () => [
        { itemId: 'i1', printFileUrl: '/u/a.png', productType: 'g', sizeLabel: 'A4' },
        { itemId: 'i2', printFileUrl: '/u/b.png', productType: 'g', sizeLabel: 'A3' },
      ]),
    })
    open(client)
    const dlg = await popOut()
    await showTab(dlg, 'Gang sheets')
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: '#1042 Acme' }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Files of #1042' }))
    expect(within(dlg).getByText('2 selected')).toBeInTheDocument()
    // Order click (async) then a file click before it settles: the file untick makes A partial, so the order tick selects all.
    act(() => {
      fireEvent.click(within(dlg).getByRole('checkbox', { name: '#1042 Acme' }))
      fireEvent.click(within(dlg).getByRole('checkbox', { name: '#1042 A4' }))
    })
    await waitFor(() => expect(within(dlg).getByRole('checkbox', { name: '#1042 Acme' })).toHaveAttribute('aria-checked', 'true'))
    expect(within(dlg).getByRole('checkbox', { name: '#1042 A4' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dlg).getByRole('checkbox', { name: '#1042 A3' })).toHaveAttribute('aria-checked', 'true')
  })

  it('canvas shortcuts do not fire while the browser is open', async () => {
    open(fakeClient())
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    const dlg = await popOut()
    act(() => {
      fireEvent.keyDown(within(dlg).getByLabelText('Search products'), { key: 'Delete' })
    })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })

  it('loads each product\'s print source once across the drawer and the browser, showing the raw design', async () => {
    const getProductPrintSource = vi.fn(async (id: string) => ({ designUrl: `/uploads/design-${id}.png`, sizes: [] }))
    open(fakeClient({ listProducts: page([product('p1', 'Tee')]), getProductPrintSource }))
    await userEvent.click(screen.getByRole('tab', { name: 'Products' }))
    const dlg = await popOut()
    await showTab(dlg, 'Products')
    const card = await within(dlg).findByRole('checkbox', { name: 'Tee' })
    await waitFor(() => expect(card.querySelector('img')).toHaveAttribute('src', 'https://x.test/uploads/design-p1.png'))
    const strip = (await screen.findAllByRole('button', { name: 'Tee' }))[0]
    await waitFor(() => expect(strip.querySelector('img')).toHaveAttribute('src', 'https://x.test/uploads/design-p1.png'))
    expect(getProductPrintSource).toHaveBeenCalledTimes(1)
  })

  describe('products quick add', () => {
    const asset = { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 3000 }
    const client = () =>
      fakeClient({
        listProductCategories: vi.fn(async () => [{ id: '3', name: 'T-Shirts' }]),
        listProducts: page([product('p1', 'Tee'), product('p2', 'Cap')]),
        getProductPrintSource: vi.fn(async () => ({ designUrl: '/uploads/d.png', sizes: ['S', 'M'] })),
      })
    beforeEach(async () => {
      vi.mocked(cacheAsset).mockResolvedValue(asset)
      uiStore.setState({ printSizeNotice: null, settingsTab: null })
      await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { M: 280 } }, oneSizeOnly: {} })
    })

    it('Add puts 1 × M of each selected product at the table width and closes', async () => {
      open(client())
      const dlg = await popOut()
      await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
      await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cap' }))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Add 2 to sheet' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Library browser' })).toBeNull())
      const items = getSheetStore().getState().sheet.items
      expect(items.map((i) => [i.source.label, i.widthMm])).toEqual([
        ['Tee — M', 280],
        ['Cap — M', 280],
      ])
      expect(items[0].source).toMatchObject({ productId: 'p1', categoryId: '3', size: 'M', sizes: ['S', 'M'] })
    })

    it('one-size-only: uses the One size width but the label keeps the picked size', async () => {
      await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { 'One size': 260, M: 280 } }, oneSizeOnly: { '3': true } })
      open(client())
      const dlg = await popOut()
      await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Add 1 to sheet' }))
      await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(1))
      const it = getSheetStore().getState().sheet.items[0]
      expect([it.widthMm, it.source.size, it.source.label]).toEqual([260, 'M', 'Tee — M'])
    })

    it('missing default: adds anyway and the drawer shows the Print sizes notice', async () => {
      await getSettingsStore().getState().setPrintSizes({ byType: { '3': { S: 250 } } })
      open(client())
      const dlg = await popOut()
      await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Add 1 to sheet' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Library browser' })).toBeNull())
      expect(getSheetStore().getState().sheet.items[0].widthMm).toBeCloseTo(254)
      expect(await screen.findByText('No default print size for T-Shirts · M — set it in Settings › Print sizes')).toBeInTheDocument()
    })

    it('Shift+Add and "Add with options…" open the add dialog instead', async () => {
      open(client())
      const dlg = await popOut()
      await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
      const user = userEvent.setup()
      await user.keyboard('{Shift>}')
      await user.click(within(dlg).getByRole('button', { name: 'Add 1 to sheet' }))
      await user.keyboard('{/Shift}')
      expect(await screen.findByRole('dialog', { name: 'Add Tee' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Tee' }))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Add with options…' }))
      expect(await screen.findByRole('dialog', { name: 'Add Tee' })).toBeInTheDocument()
      expect(getSheetStore().getState().sheet.items).toHaveLength(0)
    })

    it('"Add with options…" keeps the browser open with the no-design notice after the dialogs finish', async () => {
      const getProductPrintSource = vi.fn(async (id: string) => ({ designUrl: id === 'p2' ? null : '/uploads/d.png', sizes: ['M'] }))
      open(fakeClient({ listProductCategories: vi.fn(async () => [{ id: '3', name: 'T-Shirts' }]), listProducts: page([product('p1', 'Tee'), product('p2', 'Cap')]), getProductPrintSource }))
      const dlg = await popOut()
      await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
      await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cap' }))
      await waitFor(() => expect(getProductPrintSource).toHaveBeenCalledTimes(2))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Add with options…' }))
      const q = await screen.findByLabelText('Quantity M')
      await waitFor(() => expect(screen.getByLabelText('Width M (cm)')).toBeEnabled())
      await userEvent.clear(q)
      await userEvent.type(q, '1')
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Add Tee' })).getByRole('button', { name: 'Add' }))
      await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(1))
      expect(screen.getByRole('dialog', { name: 'Library browser' })).toBeInTheDocument()
      expect(within(screen.getByRole('dialog', { name: 'Library browser' })).getByRole('alert')).toHaveTextContent('No design file for Cap')
    })

    it('a partly failed add keeps the panel open with the error, deselects only what went in, and resets the view', async () => {
      const autoView = vi.spyOn(getViewportStore().getState(), 'autoView')
      vi.mocked(cacheAsset).mockReset().mockResolvedValueOnce(asset).mockRejectedValueOnce(new Error('boom'))
      open(client())
      const dlg = await popOut()
      await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'Tee' }))
      await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cap' }))
      await userEvent.click(within(dlg).getByRole('button', { name: 'Add 2 to sheet' }))
      expect(await within(dlg).findByRole('alert')).toHaveTextContent('Couldn\'t download "Cap": boom')
      expect(screen.getByRole('dialog', { name: 'Library browser' })).toBeInTheDocument()
      expect(getSheetStore().getState().sheet.items.map((i) => i.source.label)).toEqual(['Tee — M'])
      expect(within(dlg).getByText('1 selected')).toBeInTheDocument()
      expect(within(dlg).getByRole('checkbox', { name: 'Cap' })).toHaveAttribute('aria-checked', 'true')
      expect(autoView).toHaveBeenCalled()
    })
  })
})
