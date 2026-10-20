import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
import { AddProductDialog } from './AddProductDialog'
import { fakeClient, withClient } from './testUtils'
import { cacheAsset } from '../../platform/tauri'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import { AuthRequiredError } from '../../api/dtfClient'

const product = { id: 'p1', name: 'Tee', categoryId: '3', sizes: [] }
const asset = { assetId: 'a1', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 3000 }
const source = (sizes: string[], designUrl: string | null = '/uploads/d.png') => ({ getProductPrintSource: vi.fn(async () => ({ designUrl, sizes })) })

beforeEach(async () => {
  vi.clearAllMocks()
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
  await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: {} })
})

describe('AddProductDialog', () => {
  it('adds one entry per size with quantity > 0, labelled by size', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    const onClose = vi.fn()
    render(<AddProductDialog product={product} onClose={onClose} />, { wrapper: withClient(fakeClient(source(['S', 'M', 'L']))) })
    const m = await screen.findByLabelText('Quantity M')
    await waitFor(() => expect(m).toBeEnabled())
    expect(screen.getByLabelText('Quantity S')).toHaveValue(0)
    await userEvent.clear(m)
    await userEvent.type(m, '3')
    const l = screen.getByLabelText('Quantity L')
    await userEvent.clear(l)
    await userEvent.type(l, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const items = getSheetStore().getState().sheet.items
    expect(items).toHaveLength(5)
    expect(items.filter((i) => i.source.label === 'Tee — M')).toHaveLength(3)
    expect(items.filter((i) => i.source.label === 'Tee — L')).toHaveLength(2)
    expect(items[0].source).toMatchObject({ kind: 'gallery', id: 'p1' })
    expect(cacheAsset).toHaveBeenCalledWith('https://x.test/uploads/d.png', 'tok')
    expect(onClose).toHaveBeenCalled()
  })

  it('requires at least one size quantity', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    render(<AddProductDialog product={product} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source(['S', 'M']))) })
    await screen.findByLabelText('Quantity S')
    await waitFor(() => expect(screen.getByLabelText('Width S (cm)')).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('shows a single Quantity field (default 1) for a product without sizes', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    render(<AddProductDialog product={{ ...product, name: 'Mug' }} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source([]))) })
    const qty = await screen.findByLabelText('Quantity')
    expect(qty).toHaveValue(1)
    await waitFor(() => expect(screen.getByLabelText('Print width (cm)')).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const items = getSheetStore().getState().sheet.items
    expect(items).toHaveLength(1)
    expect(items[0].source.label).toBe('Mug')
  })

  it('clamps quantity to 500', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    render(<AddProductDialog product={product} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source([]))) })
    const qty = await screen.findByLabelText('Quantity')
    await userEvent.clear(qty)
    await userEvent.type(qty, '99999')
    expect(qty).toHaveValue(500)
  })

  it('shows a badge and disables Add when the product has no design file', async () => {
    render(<AddProductDialog product={product} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source(['M'], null))) })
    expect(await screen.findByText('No design file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(cacheAsset).not.toHaveBeenCalled()
  })

  it('shows an error when the download fails', async () => {
    vi.mocked(cacheAsset).mockRejectedValue(new Error('boom'))
    render(<AddProductDialog product={product} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source(['M']))) })
    expect(await screen.findByText('Couldn\'t download "Tee" — try again')).toBeInTheDocument()
    expect(getSheetStore().getState().sheet.items).toHaveLength(0)
  })

  it('asks for sign-in on AuthRequiredError', async () => {
    const requireLogin = vi.fn()
    vi.mocked(cacheAsset).mockRejectedValue(new AuthRequiredError())
    render(<AddProductDialog product={product} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source(['M'])), requireLogin) })
    await waitFor(() => expect(requireLogin).toHaveBeenCalled())
  })

  it('prefills each size row from Print sizes (native width otherwise), editable per row, with per-row dpi', async () => {
    await getSettingsStore().getState().setPrintWidth('3', 'M', 280)
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    render(<AddProductDialog product={product} onClose={vi.fn()} />, { wrapper: withClient(fakeClient(source(['S', 'M']))) })
    const s = await screen.findByLabelText('Width S (cm)')
    await waitFor(() => expect(s).toHaveValue(25.4))
    expect(screen.getByLabelText('Width M (cm)')).toHaveValue(28)
    expect(screen.getByText('272 dpi')).toBeInTheDocument()
    await userEvent.clear(s)
    await userEvent.type(s, '20')
    expect(screen.getByText('381 dpi')).toBeInTheDocument()
    for (const size of ['S', 'M']) {
      const q = screen.getByLabelText(`Quantity ${size}`)
      await userEvent.clear(q)
      await userEvent.type(q, '1')
    }
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const items = getSheetStore().getState().sheet.items
    expect(items.map((i) => [i.source.label, i.widthMm])).toEqual([
      ['Tee — S', 200],
      ['Tee — M', 280],
    ])
    expect(items[1].source).toEqual({ kind: 'gallery', id: 'p1', productId: 'p1', categoryId: '3', size: 'M', sizes: ['S', 'M'], label: 'Tee — M' })
  })
})
