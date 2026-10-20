import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreflightDialog } from './PreflightDialog'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn().mockResolvedValue('/out/x.prn'), open: vi.fn() }))
vi.mock('../../platform/tauri', () => ({
  createPrn: vi.fn().mockRejectedValue('The PRN engine is not installed yet (coming in the next release)'),
  writeSheetFile: vi.fn(), readSheetFile: vi.fn(),
}))
import { createPrn } from '../../platform/tauri'

function addItem(px: number) {
  getSheetStore().getState().addItems([{
    asset: { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: px, heightPx: px },
    source: { kind: 'local', id: 'a', label: 'a' }, widthMm: 100, heightMm: 100, quantity: 1,
  }])
}

describe('PreflightDialog', () => {
  beforeEach(() => {
    getSheetStore().getState().newSheet(DEFAULT_PROFILE, 'Job')
    getSettingsStore().setState({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id, setLastPrnFolder: vi.fn().mockResolvedValue(undefined) })
  })

  it('disables Create for an empty sheet', () => {
    render(<PreflightDialog onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('requires the tick for too-low designs, then shows the engine message', async () => {
    addItem(300)
    render(<PreflightDialog onClose={() => {}} />)
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await userEvent.click(screen.getByLabelText("Print anyway — I've checked the low-quality designs"))
    expect(create).toBeEnabled()
    await userEvent.click(create)
    await waitFor(() => expect(createPrn).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent('The PRN engine is not installed yet (coming in the next release)')
  })

  it('enables Create straight away for fine designs and shows size', () => {
    addItem(3000)
    render(<PreflightDialog onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    expect(screen.getByText(/181 MB/)).toBeInTheDocument()
  })
})
