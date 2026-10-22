import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../platform/tauri', () => ({ thumbSrc: (u: string) => u, cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { GangSheetsTab } from './GangSheetsTab'
import { fakeClient, withClient } from './testUtils'
import { cacheAsset } from '../../platform/tauri'
import { AuthRequiredError } from '../../api/dtfClient'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

const order = { id: 'o1', orderNumber: '#1042', status: 'confirmed', customerName: 'Acme', createdAt: '' }
const card = (id: string, n: string, customerId?: string, customerName = '') => ({ id, orderNumber: n, status: 'confirmed', customerId, customerName, createdAt: '2026-10-20T12:00:00Z' })

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

  it('asks for newest orders first', async () => {
    const client = fakeClient()
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await waitFor(() => expect(client.listOrders).toHaveBeenCalledWith(expect.objectContaining({ sort: 'created_at', order: 'desc' })))
  })

  it('on partial failure keeps only the failed file selected', async () => {
    vi.mocked(cacheAsset).mockImplementation(async (url) => {
      if (url.endsWith('bad.png')) throw new Error('nope')
      return { assetId: 'g', path: '/g.png', previewPath: '/g.jpg', widthPx: 300, heightPx: 300 }
    })
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: [order], total: 1, page: 1, hasNext: false })),
      getOrderFiles: vi.fn(async () => [
        { itemId: 'i1', printFileUrl: '/u/good.png', productType: 'g', sizeLabel: 'A' },
        { itemId: 'i2', printFileUrl: '/u/bad.png', productType: 'g', sizeLabel: 'B' },
      ]),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await userEvent.click(await screen.findByRole('button', { name: /#1042/ }))
    await userEvent.click(await screen.findByRole('button', { name: '#1042 A' }))
    await userEvent.click(screen.getByRole('button', { name: '#1042 B' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(1))
    expect(screen.getByRole('button', { name: '#1042 A' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '#1042 B' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Couldn't download #1042 B/)).toBeInTheDocument()
  })

  it('includes in-production orders when toggled', async () => {
    const client = fakeClient()
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await userEvent.click(screen.getByLabelText('Include in production'))
    await waitFor(() => expect(client.listOrders).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_production' })))
  })

  it('shows resolved customer name once per customer, date, status, file count and thumbnail', async () => {
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: [card('o1', '#1', 'c1', 'Deliv A'), card('o2', '#2', 'c1', 'Deliv B')], total: 2, page: 1, hasNext: false })),
      getCustomer: vi.fn(async () => ({ id: 'c1', name: 'Ann Lee', email: '' })),
      getOrderFiles: vi.fn(async () => [
        { itemId: 'i1', printFileUrl: '/uploads/a.png', productType: 'g', sizeLabel: 'A' },
        { itemId: 'i2', printFileUrl: '/uploads/b.png', productType: 'g', sizeLabel: 'B' },
      ]),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    expect(await screen.findAllByText('Ann Lee')).toHaveLength(2)
    expect(client.getCustomer).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('20 Oct 2026')).toHaveLength(2)
    expect(screen.getAllByText('Confirmed')).toHaveLength(2)
    expect(await screen.findAllByText('2 files')).toHaveLength(2)
    const imgs = document.querySelectorAll('.order-card img')
    expect(imgs[0]).toHaveAttribute('src', 'https://x.test/uploads/a.png')
  })

  it('falls back to delivery name, then Unknown customer', async () => {
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: [card('o1', '#1', 'c9', 'Deliv Name'), card('o2', '#2')], total: 2, page: 1, hasNext: false })),
      getCustomer: vi.fn(async () => {
        throw new Error('nope')
      }),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    expect(await screen.findByText('Deliv Name')).toBeInTheDocument()
    expect(screen.getByText('Unknown customer')).toBeInTheDocument()
  })

  it('never has more than 4 file requests in flight', async () => {
    let active = 0
    let peak = 0
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: Array.from({ length: 9 }, (_, i) => card(`o${i}`, `#${i}`)), total: 9, page: 1, hasNext: false })),
      getOrderFiles: vi.fn(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
        return []
      }),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await waitFor(() => expect(client.getOrderFiles).toHaveBeenCalledTimes(9))
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('hands slots over without exceeding 4 in flight', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: Array.from({ length: 8 }, (_, i) => card(`o${i}`, `#${i}`)), total: 8, page: 1, hasNext: false })),
      getOrderFiles: vi.fn(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((r) => releases.push(r))
        active--
        return []
      }),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client) })
    await waitFor(() => expect(releases).toHaveLength(4))
    for (let i = 0; i < 4; i++) {
      releases[i]()
      await waitFor(() => expect(releases.length).toBeGreaterThan(4 + i))
    }
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('asks for login when file loading is unauthorised, card still renders', async () => {
    const requireLogin = vi.fn()
    const client = fakeClient({
      listOrders: vi.fn(async () => ({ items: [card('o1', '#1')], total: 1, page: 1, hasNext: false })),
      getOrderFiles: vi.fn(async () => {
        throw new AuthRequiredError()
      }),
    })
    render(<GangSheetsTab />, { wrapper: withClient(client, requireLogin) })
    await waitFor(() => expect(requireLogin).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /#1/ })).toBeInTheDocument()
  })
  describe('dragging an order card', () => {
    const files2 = [
      { itemId: 'i1', printFileUrl: '/u/a.png', productType: 'g', sizeLabel: 'A' },
      { itemId: 'i2', printFileUrl: '/u/b.png', productType: 'g', sizeLabel: 'B' },
    ]
    const ptr = (type: string, x: number, y: number) => fireEvent(window, Object.assign(new Event(type), { clientX: x, clientY: y }))
    let canvas: HTMLDivElement
    const setup = (files = files2) => {
      vi.mocked(cacheAsset).mockResolvedValue({ assetId: 'as1', path: '/a.png', previewPath: '/a.jpg', widthPx: 300, heightPx: 300 })
      canvas = document.createElement('div')
      canvas.setAttribute('data-testid', 'canvas-area')
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 50, x: 0, y: 0, width: 100, height: 50, toJSON() {} })
      document.body.appendChild(canvas)
      const client = fakeClient({
        listOrders: vi.fn(async () => ({ items: [order], total: 1, page: 1, hasNext: false })),
        getOrderFiles: vi.fn(async () => files),
      })
      render(<GangSheetsTab />, { wrapper: withClient(client) })
      return client
    }
    const dragCard = async () => {
      await screen.findByText('#1042')
      const card = document.querySelector('.order-card') as HTMLElement
      fireEvent.pointerDown(card, { clientX: 300, clientY: 300, button: 0 })
      ptr('pointermove', 200, 200)
      ptr('pointermove', 50, 20)
      ptr('pointerup', 50, 20)
      return card
    }
    afterEach(() => canvas.remove())

    it('adds every file of the order when the card is dropped on the canvas', async () => {
      const client = setup()
      await dragCard()
      await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(2))
      expect(client.getOrderFiles).toHaveBeenCalledTimes(1)
      expect(getSheetStore().getState().sheet.items[0].source).toMatchObject({ kind: 'order-file', orderNumber: '#1042' })
    })

    it('adds only the ticked files of that order', async () => {
      setup()
      await userEvent.click(await screen.findByRole('button', { name: /#1042/ }))
      await userEvent.click(await screen.findByRole('button', { name: '#1042 B' }))
      await dragCard()
      await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(1))
      expect(getSheetStore().getState().sheet.items[0].source).toMatchObject({ id: 'i2' })
    })

    it('double-click adds the order files', async () => {
      setup()
      await userEvent.dblClick(await screen.findByRole('button', { name: /#1042/ }))
      await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(2))
    })

    it('a drag does not also expand the card', async () => {
      setup()
      const card = await dragCard()
      fireEvent.click(card)
      await waitFor(() => expect(getSheetStore().getState().sheet.items).toHaveLength(2))
      expect(card).toHaveAttribute('aria-expanded', 'false')
    })

    it('the no-print-files notice is not hidden by an earlier error', async () => {
      const client = setup([])
      vi.mocked(client.getOrderFiles).mockRejectedValue(new Error('network down'))
      await dragCard()
      expect(await screen.findByText('network down')).toBeInTheDocument()
      vi.mocked(client.getOrderFiles).mockResolvedValue([])
      await dragCard()
      expect(await screen.findByText('Order #1042 has no print files yet')).toBeInTheDocument()
      expect(screen.queryByText('network down')).toBeNull()
    })

    it('says so when the order has no print files', async () => {
      setup([])
      await dragCard()
      expect(await screen.findByText('Order #1042 has no print files yet')).toBeInTheDocument()
      expect(getSheetStore().getState().sheet.items).toHaveLength(0)
    })
  })
})
