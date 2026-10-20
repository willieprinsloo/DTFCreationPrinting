import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
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

  it('shows thumbnails from thumbnailUrl', async () => {
    render(<ProductsTab />, { wrapper: withClient(fakeClient({ listProducts: list() })) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    expect(btn.querySelector('img')).toHaveAttribute('src', 'https://x.test/uploads/t.png')
  })

  it('products without a thumbnail get a placeholder instead of an empty img', async () => {
    render(<ProductsTab />, { wrapper: withClient(fakeClient({ listProducts: list([{ ...tee, thumbnailUrl: undefined as never }]) })) })
    const btn = await screen.findByRole('button', { name: 'Tee' })
    expect(btn.querySelector('img')).toBeNull()
    expect(screen.getByTestId('thumb-placeholder')).toBeInTheDocument()
  })

  it('opens the dialog on Add; a product without a design file cannot be added', async () => {
    const client = fakeClient({ listProducts: list(), getProductPrintSource: vi.fn(async () => ({ designUrl: null, sizes: ['M'] })) })
    render(<ProductsTab />, { wrapper: withClient(client) })
    await userEvent.click(await screen.findByRole('button', { name: 'Tee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('No design file')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('button[type=submit]')).toBeDisabled()
  })
})
