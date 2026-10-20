import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreflightDialog } from './PreflightDialog'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import { fakeClient, withClient } from '../library/testUtils'
import { AuthRequiredError, type DtfClient } from '../../api/dtfClient'
import type { SourceRef } from '../../domain/types'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn().mockResolvedValue('/out/x.prn'), open: vi.fn() }))
vi.mock('../../platform/tauri', () => {
  class PrnCancelledError extends Error {}
  return { createPrn: vi.fn(), revealInFolder: vi.fn().mockResolvedValue(undefined), PrnCancelledError, writeSheetFile: vi.fn(), readSheetFile: vi.fn() }
})
import { createPrn, revealInFolder, PrnCancelledError } from '../../platform/tauri'

const STATS = { lines: 100, bytes: 1.2e9, millis: 9000 }

/** Makes createPrn hand back a job the test settles by hand. */
function controlledJob() {
  const ctl = {} as { progress(f: number): void; resolve(v: typeof STATS): void; reject(e: unknown): void; cancel: ReturnType<typeof vi.fn<() => void>> }
  ctl.cancel = vi.fn<() => void>()
  vi.mocked(createPrn).mockImplementation((_sheet, _profile, _path, onProgress) => {
    ctl.progress = onProgress
    const promise = new Promise<typeof STATS>((res, rej) => {
      ctl.resolve = res
      ctl.reject = rej
    })
    return { promise, cancel: ctl.cancel }
  })
  return ctl
}

function addItem(px: number, source: SourceRef = { kind: 'local', id: 'a', label: 'a' }) {
  getSheetStore().getState().addItems([{
    asset: { assetId: source.id, path: `/cache/${source.id}.png`, previewPath: `/cache/${source.id}.jpg`, widthPx: px, heightPx: px },
    source, widthMm: 100, heightMm: 100, quantity: 1,
  }])
}

const order = (id: string, orderId: string, orderNumber: string): SourceRef => ({ kind: 'order-file', id, label: id, orderId, orderNumber })

function renderDialog(client: DtfClient = fakeClient(), requireLogin = vi.fn()) {
  return render(<PreflightDialog onClose={() => {}} />, { wrapper: withClient(client, requireLogin) })
}

describe('PreflightDialog', () => {
  beforeEach(() => {
    vi.mocked(createPrn).mockReset()
    vi.mocked(revealInFolder).mockClear()
    getSheetStore().getState().newSheet(DEFAULT_PROFILE, 'Job')
    getSettingsStore().setState({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id, setLastPrnFolder: vi.fn().mockResolvedValue(undefined) })
  })

  it('disables Create for an empty sheet', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('requires the tick for too-low designs, then shows the engine message', async () => {
    const job = controlledJob()
    addItem(300)
    renderDialog()
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await userEvent.click(screen.getByLabelText("Print anyway — I've checked the low-quality designs"))
    expect(create).toBeEnabled()
    await userEvent.click(create)
    await waitFor(() => expect(createPrn).toHaveBeenCalled())
    act(() => job.reject(new Error('There is nothing to print on this sheet')))
    expect(await screen.findByRole('alert')).toHaveTextContent('There is nothing to print on this sheet')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('enables Create straight away for fine designs and shows size', () => {
    addItem(3000)
    renderDialog()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    expect(screen.getByText(/181 MB/)).toBeInTheDocument()
  })

  it('shows the printed length next to the sheet length', () => {
    addItem(3000)
    renderDialog()
    expect(screen.getByText(/Length 11\.0 cm/)).toBeInTheDocument()
    expect(screen.getByText('Printed length: 10.0 cm')).toBeInTheDocument()
  })

  it('sends the sheet and its profile to the engine and shows progress', async () => {
    const job = controlledJob()
    addItem(3000)
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createPrn).toHaveBeenCalled())
    const [sheetArg, profileArg, pathArg] = vi.mocked(createPrn).mock.calls[0]
    expect(sheetArg).toBe(getSheetStore().getState().sheet)
    expect(profileArg).toEqual(DEFAULT_PROFILE)
    expect(pathArg).toBe('/out/x.prn')
    const bar = await screen.findByRole('progressbar')
    expect(bar).toHaveAttribute('value', '0')
    act(() => job.progress(0.42))
    expect(bar).toHaveAttribute('value', '0.42')
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('Cancel stops the job and just closes the progress, with no error', async () => {
    const job = controlledJob()
    addItem(3000)
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(job.cancel).toHaveBeenCalledTimes(1)
    act(() => job.reject(new PrnCancelledError('Cancelled')))
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('on success shows the file, size and time, and Show in folder reveals it', async () => {
    const job = controlledJob()
    addItem(3000)
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    expect(await screen.findByText('Saved x.prn (1.2 GB, 9 s)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(revealInFolder).toHaveBeenCalledWith('/out/x.prn')
  })

  it('marks each distinct order In production after success when the box is ticked (default)', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    addItem(3000, order('f2', 'o1', '1001'))
    addItem(3000, order('f3', 'o2', '1002'))
    const client = fakeClient()
    renderDialog(client)
    const box = screen.getByLabelText('Mark 2 orders as In production in DTF Creations')
    expect(box).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    expect(client.setOrderStatus).not.toHaveBeenCalled()
    act(() => job.resolve(STATS))
    await screen.findByText(/Saved x\.prn/)
    await waitFor(() => expect(client.setOrderStatus).toHaveBeenCalledTimes(2))
    expect(client.setOrderStatus).toHaveBeenCalledWith('o1', 'in_production')
    expect(client.setOrderStatus).toHaveBeenCalledWith('o2', 'in_production')
  })

  it('does not touch orders when the box is unticked', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    const client = fakeClient()
    renderDialog(client)
    await userEvent.click(screen.getByLabelText('Mark 1 order as In production in DTF Creations'))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    await screen.findByText(/Saved x\.prn/)
    expect(client.setOrderStatus).not.toHaveBeenCalled()
  })

  it('does not mark orders when the PRN fails or is cancelled', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    const client = fakeClient()
    renderDialog(client)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.reject(new Error('Creating the PRN failed: disk full')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Creating the PRN failed: disk full')
    expect(client.setOrderStatus).not.toHaveBeenCalled()
  })

  it('lists orders that could not be marked without hiding the success, and asks to sign in on auth errors', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    addItem(3000, order('f2', 'o2', '1002'))
    addItem(3000, order('f3', 'o3', '1003'))
    const setOrderStatus = vi.fn(async (id: string) => {
      if (id === 'o2') throw new Error('Order is already shipped')
      if (id === 'o3') throw new AuthRequiredError()
    })
    const requireLogin = vi.fn()
    renderDialog(fakeClient({ setOrderStatus }), requireLogin)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    const failures = await screen.findByRole('list', { name: 'Orders not updated' })
    expect(failures).toHaveTextContent('Order 1002: Order is already shipped')
    expect(failures).toHaveTextContent('Order 1003')
    expect(failures).not.toHaveTextContent('1001')
    expect(screen.getByText('Saved x.prn (1.2 GB, 9 s)')).toBeInTheDocument()
    expect(requireLogin).toHaveBeenCalledTimes(1)
  })

  it('does not mark orders when the render is cancelled', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    const client = fakeClient()
    renderDialog(client)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    act(() => job.reject(new PrnCancelledError('Cancelled')))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled())
    expect(client.setOrderStatus).not.toHaveBeenCalled()
  })

  it('says it is updating orders while they are being marked', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    let finish!: () => void
    const setOrderStatus = vi.fn(() => new Promise<void>((r) => (finish = r)))
    renderDialog(fakeClient({ setOrderStatus }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    const status = await screen.findByText('Updating orders in DTF Creations…')
    expect(status).toHaveAttribute('role', 'status')
    act(() => finish())
    await waitFor(() => expect(screen.queryByText('Updating orders in DTF Creations…')).not.toBeInTheDocument())
  })

  it('never marks the same order twice in one session and unticks the box after a full success', async () => {
    let job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    addItem(3000, order('f2', 'o2', '1002'))
    const client = fakeClient()
    renderDialog(client)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    await waitFor(() => expect(client.setOrderStatus).toHaveBeenCalledTimes(2))
    const box = screen.getByLabelText('Mark 2 orders as In production in DTF Creations')
    await waitFor(() => expect(box).not.toBeChecked())

    await userEvent.click(box)
    job = controlledJob()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    await screen.findByText(/Saved x\.prn/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled())
    expect(client.setOrderStatus).toHaveBeenCalledTimes(2)
  })

  it('on a repeat Create only retries the orders that failed, and keeps the box ticked after a failure', async () => {
    let job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    addItem(3000, order('f2', 'o2', '1002'))
    const setOrderStatus = vi.fn(async (id: string) => {
      if (id === 'o2' && setOrderStatus.mock.calls.length <= 2) throw new Error('Server busy')
    })
    renderDialog(fakeClient({ setOrderStatus }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    await screen.findByRole('list', { name: 'Orders not updated' })
    expect(screen.getByLabelText('Mark 2 orders as In production in DTF Creations')).toBeChecked()

    job = controlledJob()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    await waitFor(() => expect(setOrderStatus).toHaveBeenCalledTimes(3))
    expect(setOrderStatus.mock.calls.map((c) => c[0])).toEqual(['o1', 'o2', 'o2'])
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Orders not updated' })).not.toBeInTheDocument())
  })

  it('only moves confirmed orders forward and lists the others as not changed', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    addItem(3000, order('f2', 'o2', '1002'))
    addItem(3000, order('f3', 'o3', '1003'))
    addItem(3000, order('f4', 'o4', '1004'))
    const statuses: Record<string, string> = { o1: 'confirmed', o2: 'in_production', o3: 'shipped', o4: 'delivered' }
    const getOrderStatus = vi.fn(async (id: string) => statuses[id])
    const client = fakeClient({ getOrderStatus })
    renderDialog(client)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    const skipped = await screen.findByRole('list', { name: 'Orders not changed' })
    expect(getOrderStatus).toHaveBeenCalledTimes(4)
    expect(client.setOrderStatus).toHaveBeenCalledTimes(1)
    expect(client.setOrderStatus).toHaveBeenCalledWith('o1', 'in_production')
    expect(skipped).toHaveTextContent('Order 1002: Already in production — not changed')
    expect(skipped).toHaveTextContent('Order 1003: Already shipped — not changed')
    expect(skipped).toHaveTextContent('Order 1004: Already delivered — not changed')
    expect(skipped).not.toHaveTextContent('1001')
    expect(screen.queryByRole('list', { name: 'Orders not updated' })).not.toBeInTheDocument()
  })

  it('does not change an order whose status cannot be read, and lists it as a failure', async () => {
    const job = controlledJob()
    addItem(3000, order('f1', 'o1', '1001'))
    addItem(3000, order('f2', 'o2', '1002'))
    const getOrderStatus = vi.fn(async (id: string) => {
      if (id === 'o2') throw new Error('Server busy')
      return 'confirmed'
    })
    const client = fakeClient({ getOrderStatus })
    renderDialog(client)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    act(() => job.resolve(STATS))
    const failures = await screen.findByRole('list', { name: 'Orders not updated' })
    expect(failures).toHaveTextContent('Order 1002: Server busy')
    expect(client.setOrderStatus).toHaveBeenCalledTimes(1)
    expect(client.setOrderStatus).toHaveBeenCalledWith('o1', 'in_production')
  })

  it('cancels a running job when the dialog closes', async () => {
    const job = controlledJob()
    addItem(3000)
    const { unmount } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('progressbar')
    unmount()
    expect(job.cancel).toHaveBeenCalledTimes(1)
  })
})
