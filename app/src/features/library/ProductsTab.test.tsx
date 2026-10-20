import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { cacheAsset } from '../../platform/tauri'
import { AuthRequiredError } from '../../api/dtfClient'
import { ProductsTab } from './ProductsTab'
import { fakeClient, withClient } from './testUtils'

const tee = { id: 'p1', name: 'Tee', categoryId: '3', sizes: ['S', 'M'], thumbnailUrl: '/uploads/t.png' }
const list = (items = [tee]) => vi.fn(async () => ({ items, total: items.length, page: 1, hasNext: false }))

beforeEach(() => vi.clearAllMocks())

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

  it('opens the dialog on Add using the cached print source', async () => {
    vi.mocked(cacheAsset).mockResolvedValue({ id: 'a', widthPx: 300, heightPx: 300 } as never)
    const client = fakeClient({ listProducts: list(), getProductPrintSource: vi.fn(async () => ({ designUrl: '/uploads/d.png', sizes: ['M'] })) })
    render(<ProductsTab />, { wrapper: withClient(client) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    await waitFor(() => expect(btn.querySelector('img')).not.toBeNull())
    await userEvent.click(btn)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByLabelText('Quantity M')).toBeInTheDocument()
    expect(client.getProductPrintSource).toHaveBeenCalledTimes(1)
  })
})
