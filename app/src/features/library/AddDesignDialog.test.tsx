import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { AddDesignDialog } from './AddDesignDialog'
import { fakeClient, withClient } from './testUtils'
import { cacheAsset } from '../../platform/tauri'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

const design = { id: 'd1', name: 'Lion', imageUrl: '/u/lion.png', designType: 'sticker', galleryCategoryId: 'c', tags: [] }
const asset = { assetId: 'a1', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 3000 }

beforeEach(() => {
  vi.clearAllMocks()
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
})

describe('AddDesignDialog', () => {
  it('defaults to native 300 dpi size capped to the printable width', async () => {
    vi.mocked(cacheAsset).mockResolvedValue({ ...asset, widthPx: 9000, heightPx: 9000 })
    render(<AddDesignDialog design={design} onClose={vi.fn()} />, { wrapper: withClient(fakeClient()) })
    expect(await screen.findByLabelText('Print width (cm)')).toHaveValue(59)
  })

  it('shows live dpi and adds with the chosen quantity', async () => {
    vi.mocked(cacheAsset).mockResolvedValue(asset)
    const onClose = vi.fn()
    render(<AddDesignDialog design={design} customerName="Acme" onClose={onClose} />, { wrapper: withClient(fakeClient()) })
    const width = await screen.findByLabelText('Print width (cm)')
    await waitFor(() => expect(width).toBeEnabled())
    await userEvent.clear(width)
    await userEvent.type(width, '50.8')
    expect(screen.getByText('150 dpi')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    const qty = screen.getByLabelText('Quantity')
    await userEvent.clear(qty)
    await userEvent.type(qty, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const items = getSheetStore().getState().sheet.items
    expect(items).toHaveLength(3)
    expect(items[0].widthMm).toBeCloseTo(508)
    expect(items[0].source).toMatchObject({ kind: 'gallery', id: 'd1', label: 'Lion', customerName: 'Acme' })
    expect(cacheAsset).toHaveBeenCalledWith('https://x.test/u/lion.png', 'tok')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error and adds nothing when the download fails', async () => {
    vi.mocked(cacheAsset).mockRejectedValue(new Error('boom'))
    render(<AddDesignDialog design={design} onClose={vi.fn()} />, { wrapper: withClient(fakeClient()) })
    expect(await screen.findByText('Couldn\'t download "Lion" — try again')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(getSheetStore().getState().sheet.items).toHaveLength(0)
  })
})
