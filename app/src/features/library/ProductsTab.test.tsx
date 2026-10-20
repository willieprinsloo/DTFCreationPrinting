import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
vi.mock('./dragAdd', () => ({ beginLibraryDrag: vi.fn() }))
import { cacheAsset } from '../../platform/tauri'
import { AuthRequiredError } from '../../api/dtfClient'
import { ProductsTab } from './ProductsTab'
import { PrintSizeNotice } from './PrintSizeNotice'
import { beginLibraryDrag } from './dragAdd'
import { fakeClient, withClient } from './testUtils'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import { getSheetStore } from '../../state/sheetStore'
import { uiStore } from '../../state/uiStore'

const tee = { id: 'p1', name: 'Tee', categoryId: '3', sizes: ['S', 'M'], thumbnailUrl: '/uploads/t.png' }
const list = (items = [tee]) => vi.fn(async () => ({ items, total: items.length, page: 1, hasNext: false }))

const asset = { assetId: 'a1', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 1500 }
const sized = (sizes = ['S', 'M', 'L']) => ({
  listProductCategories: vi.fn(async () => [{ id: '3', name: 'T-Shirts' }]),
  listProducts: list([{ ...tee, sizes }]),
  getProductPrintSource: vi.fn(async () => ({ designUrl: '/uploads/d.png', sizes })),
})
const items = () => getSheetStore().getState().sheet.items

beforeEach(async () => {
  vi.clearAllMocks()
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
  uiStore.setState({ printSizeNotice: null, settingsTab: null })
  await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { M: 280, L: 300 } }, oneSizeOnly: {} })
})

describe('ProductsTab', () => {
  it('searches once after the 300 ms debounce', async () => {
    const client = fakeClient()
    render(<ProductsTab />, { wrapper: withClient(client) })
    await waitFor(() => expect(client.listProducts).toHaveBeenCalledTimes(1))
    await userEvent.type(screen.getByLabelText('Search products'), 'tee')
    await waitFor(() => expect(client.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'tee', limit: 50 })))
    expect(vi.mocked(client.listProducts).mock.calls.filter((c) => c[0].search === 'tee')).toHaveLength(1)
  })

  it('Type filter lists product categories and passes categoryId', async () => {
    const client = fakeClient({ listProductCategories: vi.fn(async () => [{ id: '3', name: 'T-Shirts' }]), listProducts: list() })
    render(<ProductsTab />, { wrapper: withClient(client) })
    await screen.findByRole('button', { name: 'Tee' })
    await screen.findByRole('option', { name: 'T-Shirts' })
    await userEvent.selectOptions(screen.getByLabelText('Type'), '3')
    await waitFor(() => expect(client.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: '3' })))
  })

  it('shows the raw design (not the mockup) with a placeholder while it loads', async () => {
    let resolve!: (v: { designUrl: string; sizes: string[] }) => void
    const getProductPrintSource = vi.fn(() => new Promise<{ designUrl: string; sizes: string[] }>((r) => (resolve = r)))
    render(<ProductsTab />, { wrapper: withClient(fakeClient({ listProducts: list(), getProductPrintSource })) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    expect(btn.querySelector('img')).toBeNull()
    expect(screen.getByTestId('thumb-placeholder')).toBeInTheDocument()
    resolve({ designUrl: '/uploads/design.png', sizes: [] })
    await waitFor(() => expect(btn.querySelector('img')).toHaveAttribute('src', 'https://x.test/uploads/design.png'))
    expect(getProductPrintSource).toHaveBeenCalledTimes(1)
  })

  it('shows a "No design file" badge and refuses to add a product without a design', async () => {
    const client = fakeClient({ listProducts: list(), getProductPrintSource: vi.fn(async () => ({ designUrl: null, sizes: ['M'] })) })
    render(<ProductsTab />, { wrapper: withClient(client) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    expect(await within(btn).findByText('No design file')).toBeInTheDocument()
    expect(btn.querySelector('img')).toBeNull()
    await userEvent.click(btn)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('No design file for Tee')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for sign-in on auth errors and leaves the placeholder on other errors', async () => {
    const requireLogin = vi.fn()
    const getProductPrintSource = vi.fn(async (id: string) => {
      throw id === 'p1' ? new AuthRequiredError() : new Error('boom')
    })
    const items = [tee, { ...tee, id: 'p2', name: 'Hoodie' }]
    render(<ProductsTab />, { wrapper: withClient(fakeClient({ listProducts: list(items), getProductPrintSource }), requireLogin) })
    await screen.findByRole('button', { name: 'Hoodie' })
    await waitFor(() => expect(requireLogin).toHaveBeenCalledTimes(1))
    expect(screen.getAllByTestId('thumb-placeholder')).toHaveLength(2)
  })

  it('products without a thumbnail get a placeholder instead of an empty img', async () => {
    render(<ProductsTab />, { wrapper: withClient(fakeClient({ listProducts: list([{ ...tee, thumbnailUrl: undefined as never }]) })) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    expect(btn.querySelector('img')).toBeNull()
    expect(screen.getByTestId('thumb-placeholder')).toBeInTheDocument()
  })

  it('Add quick-adds 1 × the default size at the table width, with the product source fields', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    const client = fakeClient(sized())
    render(<ProductsTab />, { wrapper: withClient(client) })
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(items()[0]).toMatchObject({ widthMm: 280, heightMm: 140 })
    expect(items()[0].source).toEqual({ kind: 'gallery', id: 'p1', productId: 'p1', categoryId: '3', size: 'M', sizes: ['S', 'M', 'L'], label: 'Tee — M' })
    expect(cacheAsset).toHaveBeenCalledWith('https://x.test/uploads/d.png', 'tok')
    expect(uiStore.getState().printSizeNotice).toBeNull()
    expect(client.getProductPrintSource).toHaveBeenCalledTimes(1)
  })

  it('without a table entry adds at the native 300 dpi width and shows a notice that opens Settings › Print sizes', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    render(
      <>
        <ProductsTab />
        <PrintSizeNotice />
      </>,
      { wrapper: withClient(fakeClient(sized(['XL', '2XL']))) },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    await screen.findByRole('option', { name: 'T-Shirts' })
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(items()).toHaveLength(1))
    // 3000 px at 300 dpi = 254 mm (inside the 590 mm printable width)
    expect(items()[0].widthMm).toBeCloseTo(254)
    expect(items()[0].source).toMatchObject({ size: 'XL', label: 'Tee — XL' })
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent('No default print size for T-Shirts · XL — set it in Settings › Print sizes')
    await userEvent.click(within(note).getByRole('button', { name: 'Open Print sizes' }))
    expect(uiStore.getState().settingsTab).toBe('print-sizes')
  })

  it('a product without sizes uses the One size width', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    await getSettingsStore().getState().setPrintWidth('3', null, 90)
    render(<ProductsTab />, { wrapper: withClient(fakeClient(sized([]))) })
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(items()[0].widthMm).toBe(90)
    expect(items()[0].source).toMatchObject({ size: null, sizes: [], label: 'Tee' })
  })

  it('dragging a product quick-adds it; Shift+drag opens the dialog', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    render(<ProductsTab />, { wrapper: withClient(fakeClient(sized())) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    fireEvent.pointerDown(btn, { button: 0 })
    vi.mocked(beginLibraryDrag).mock.calls[0][2]()
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.pointerDown(btn, { button: 0, shiftKey: true })
    vi.mocked(beginLibraryDrag).mock.calls[1][2]()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(items()).toHaveLength(1)
  })

  it('Shift+Add and "Add with options…" open the dialog with per-size widths from the table', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    const client = fakeClient(sized())
    render(<ProductsTab />, { wrapper: withClient(client) })
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.keyboard('{/Shift}')
    const dlg = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dlg).getByLabelText('Width M (cm)')).toHaveValue(28))
    expect(within(dlg).getByLabelText('Width L (cm)')).toHaveValue(30)
    expect(within(dlg).getByLabelText('Width S (cm)')).toHaveValue(25.4)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add with options…' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(items()).toHaveLength(0)
    expect(client.getProductPrintSource).toHaveBeenCalledTimes(1)
  })

  it('Add with several products selected quick-adds each', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    const client = fakeClient({ ...sized(), listProducts: list([{ ...tee, sizes: ['M'] }, { ...tee, id: 'p2', name: 'Hoodie', sizes: ['M'] }]) })
    render(<ProductsTab />, { wrapper: withClient(client) })
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hoodie' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(items()).toHaveLength(2))
    expect(items().map((i) => i.source.label)).toEqual(['Tee — M', 'Hoodie — M'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a one-size-only type uses its One size width whatever the garment sizes, with size null', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    await getSettingsStore().getState().setPrintWidth('3', null, 250)
    await getSettingsStore().getState().setOneSizeOnly('3', true)
    render(<ProductsTab />, { wrapper: withClient(fakeClient(sized())) })
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(items()[0].widthMm).toBe(250)
    expect(items()[0].source).toMatchObject({ size: null, sizes: ['S', 'M', 'L'], label: 'Tee' })
  })

  it('a partly failed quick add deselects only the added products and asks for sign-in once', async () => {
    vi.mocked(cacheAsset).mockResolvedValueOnce(asset).mockRejectedValueOnce(new AuthRequiredError()).mockRejectedValueOnce(new AuthRequiredError())
    const requireLogin = vi.fn()
    const three = [{ ...tee, sizes: ['M'] }, { ...tee, id: 'p2', name: 'Hoodie', sizes: ['M'] }, { ...tee, id: 'p4', name: 'Cap', sizes: ['M'] }]
    render(<ProductsTab />, { wrapper: withClient(fakeClient({ ...sized(), listProducts: list(three) }), requireLogin) })
    for (const n of ['Tee', 'Hoodie', 'Cap']) await userEvent.click(await screen.findByRole('button', { name: n }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Couldn\'t download "Hoodie", "Cap" — try again')).toBeInTheDocument()
    expect(items()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Tee' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Hoodie' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Cap' })).toHaveAttribute('aria-pressed', 'true')
    expect(requireLogin).toHaveBeenCalledTimes(1)
  })
})
