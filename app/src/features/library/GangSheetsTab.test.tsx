import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { GangSheetsTab } from './GangSheetsTab'
import { fakeClient, withClient } from './testUtils'
import { cacheAsset } from '../../platform/tauri'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

const order = { id: 'o1', orderNumber: '#1042', status: 'confirmed', customerName: 'Acme', createdAt: '' }

beforeEach(() => {
  vi.clearAllMocks()
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
})

describe('GangSheetsTab', () => {
  it('lists confirmed orders, expands files and adds at 300 dpi native size', async () => {
    vi.mocked(cacheAsset).mockResolvedValue({ assetId: 'as1', path: '/a.png', previewPath: '/a.jpg', widthPx: 3543, heightPx: 1772 })
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: [order], total: 1, page: 1, hasNext: false })),
      getOrderFiles: vi.fn(async () => [{ itemId: 'i1', printFileUrl: '/u/p.png', productType: 'gang', sizeLabel: '30x60' }]),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await waitFor(() => expect(client.listOrders).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' })))
    await userEvent.click(await screen.findByRole('button', { name: /#1042/ }))
    await userEvent.click(await screen.findByRole('button', { name: '#1042 30x60' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(1))
    expect(cacheAsset).toHaveBeenCalledWith('https://x.test/u/p.png', 'tok')
    const it = getSheetStore().getState().sheet.items[0]
    expect(it.widthMm).toBeCloseTo(300, 0)
    expect(it.source).toMatchObject({ kind: 'order-file', id: 'i1', orderId: 'o1', orderNumber: '#1042', customerName: 'Acme' })
  })

  it('includes in-production orders when toggled', async () => {
    const client = fakeClient()
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await userEvent.click(screen.getByLabelText('Include in production'))
    await waitFor(() => expect(client.listOrders).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_production' })))
  })
})
