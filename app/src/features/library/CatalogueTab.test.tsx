import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { CatalogueTab } from './CatalogueTab'
import { fakeClient, withClient } from './testUtils'
import { AuthRequiredError } from '../../api/dtfClient'

const design = { id: 'd1', name: 'Lion', imageUrl: '/u/lion.png', thumbnailUrl: '/u/lion-t.png', designType: 'sticker', galleryCategoryId: 'c', tags: [] }

beforeEach(() => vi.clearAllMocks())

describe('CatalogueTab', () => {
  it('searches once after the 300 ms debounce', async () => {
    const client = fakeClient()
    render(<CatalogueTab />, { wrapper: withClient(client) })
    await waitFor(() => expect(client.listGalleryDesigns).toHaveBeenCalledTimes(1))
    await userEvent.type(screen.getByLabelText('Search designs'), 'lion')
    await waitFor(() => expect(client.listGalleryDesigns).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'lion', limit: 50 })))
    const withSearch = vi.mocked(client.listGalleryDesigns).mock.calls.filter((c) => c[0].search === 'lion')
    expect(withSearch).toHaveLength(1)
  })

  it('maps the Customer chip to owner', async () => {
    const client = fakeClient({ listCustomers: vi.fn(async () => [{ id: 'acme-id', name: 'Acme', email: 'a@acme.test' }]) })
    render(<CatalogueTab />, { wrapper: withClient(client) })
    await userEvent.click(screen.getByRole('button', { name: 'Customer' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Acme' }))
    await waitFor(() => expect(client.listGalleryDesigns).toHaveBeenLastCalledWith(expect.objectContaining({ owner: 'acme-id' })))
  })

  it('shows thumbnails from thumbnailUrl without caching', async () => {
    const client = fakeClient({ listGalleryDesigns: vi.fn(async () => ({ items: [design], total: 1, page: 1, hasNext: false })) })
    render(<CatalogueTab />, { wrapper: withClient(client) })
    const btn = await screen.findByRole('button', { name: 'Lion' })
    expect(btn.querySelector('img')).toHaveAttribute('src', 'https://x.test/u/lion-t.png')
  })

  it('keeps loaded thumbnails and shows the offline message on failure', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [design], total: 1, page: 1, hasNext: false })
      .mockRejectedValue(new Error("Can't reach DTF Creations — working offline"))
    render(<CatalogueTab />, { wrapper: withClient(fakeClient({ listGalleryDesigns: list })) })
    await screen.findByRole('button', { name: 'Lion' })
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'sticker')
    expect(await screen.findByText("Can't reach DTF Creations — working offline")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lion' })).toBeInTheDocument()
  })

  it('passes the Type and Category filters to the API', async () => {
    const client = fakeClient({
      listGalleryDesigns: vi.fn(async () => ({ items: [design], total: 1, page: 1, hasNext: false })),
      listGalleryCategories: vi.fn(async () => [{ id: 'cat9', name: 'Animals' }]),
    })
    render(<CatalogueTab />, { wrapper: withClient(client) })
    await screen.findByRole('button', { name: 'Lion' })
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'sticker')
    await waitFor(() => expect(client.listGalleryDesigns).toHaveBeenLastCalledWith(expect.objectContaining({ designType: 'sticker' })))
    await userEvent.selectOptions(await screen.findByRole('option', { name: 'Animals' }).then(() => screen.getByLabelText('Category')), 'cat9')
    await waitFor(() =>
      expect(client.listGalleryDesigns).toHaveBeenLastCalledWith(expect.objectContaining({ designType: 'sticker', categoryId: 'cat9' })),
    )
  })

  it('asks for sign-in on AuthRequiredError', async () => {
    const requireLogin = vi.fn()
    const client = fakeClient({ listGalleryDesigns: vi.fn(async () => { throw new AuthRequiredError() }) })
    render(<CatalogueTab />, { wrapper: withClient(client, requireLogin) })
    await waitFor(() => expect(requireLogin).toHaveBeenCalled())
  })
})
