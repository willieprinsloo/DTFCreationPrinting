import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
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
    await waitFor(() => expect(client.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: '2026-10-13' })))
    vi.mocked(client.listOrders).mockClear()
    await userEvent.selectOptions(within(dlg).getByLabelText('Status'), 'both')
    await waitFor(() => expect(client.listOrders).toHaveBeenCalledTimes(2))
    expect(vi.mocked(client.listOrders).mock.calls.map((c) => c[0].status).sort()).toEqual(['confirmed', 'in_production'])
    expect(within(dlg).getByText(/Filtered by Status: Confirmed \+ in production · Date: Last 7 days/)).toBeInTheDocument()
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

  it('ticking an order selects all its files; Add adds them, closes and fits the canvas', async () => {
    vi.mocked(cacheAsset).mockResolvedValue({ assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 300, heightPx: 300 })
    const fit = vi.spyOn(getViewportStore().getState(), 'fit')
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
    expect(fit).toHaveBeenCalled()
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
})
