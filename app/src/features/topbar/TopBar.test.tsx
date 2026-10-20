import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopBar } from './TopBar'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import type { PrinterProfile } from '../../domain/types'

const narrow: PrinterProfile = { ...DEFAULT_PROFILE, id: 'dtf-30', name: 'DTF 30 cm', widthMm: 300, defaultGapMm: 2 }
const broken: PrinterProfile = { ...DEFAULT_PROFILE, id: 'bad', name: 'Broken', widthMm: 8 }

function setup(setActiveProfile = vi.fn().mockResolvedValue(undefined)) {
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
  getSettingsStore().setState({ profiles: [DEFAULT_PROFILE, narrow, broken], activeProfileId: DEFAULT_PROFILE.id, setActiveProfile })
  return setActiveProfile
}

describe('TopBar profile select', () => {
  beforeEach(() => setup())

  it('applies the chosen profile to the sheet', async () => {
    const spy = setup()
    render(<TopBar />)
    await userEvent.selectOptions(screen.getByLabelText('Printer profile'), 'dtf-30')
    const { sheet } = getSheetStore().getState()
    expect(sheet.profileId).toBe('dtf-30')
    expect(sheet.settings.widthMm).toBe(300)
    expect(sheet.settings.gapMm).toBe(2)
    expect(spy).toHaveBeenCalledWith('dtf-30')
  })

  it('shows an error and keeps the sheet profile when the profile cannot fit', async () => {
    render(<TopBar />)
    await userEvent.selectOptions(screen.getByLabelText('Printer profile'), 'bad')
    expect(screen.getByRole('alert')).toHaveTextContent('Margins leave no printable width')
    expect(getSheetStore().getState().sheet.profileId).toBe(DEFAULT_PROFILE.id)
    expect(screen.getByLabelText('Printer profile')).toHaveValue(DEFAULT_PROFILE.id)
  })

  it('shows an error when saving the active profile fails', async () => {
    setup(vi.fn().mockRejectedValue(new Error('disk full')))
    render(<TopBar />)
    await userEvent.selectOptions(screen.getByLabelText('Printer profile'), 'dtf-30')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('disk full'))
  })
})

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn().mockResolvedValue(true), save: vi.fn(), open: vi.fn() }))

describe('TopBar File menu', () => {
  beforeEach(() => setup())

  it('lists the file actions and recent sheets', async () => {
    getSettingsStore().setState({ recentSheets: ['/x/Job one.dtfsheet'] })
    render(<TopBar />)
    await userEvent.click(screen.getByRole('button', { name: 'File' }))
    for (const n of ['New', 'Open…', 'Save', 'Save as…']) expect(screen.getByRole('menuitem', { name: n })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Job one.dtfsheet' })).toBeInTheDocument()
  })

  it('New resets the sheet', async () => {
    getSheetStore().setState({ sheet: { ...getSheetStore().getState().sheet, name: 'Old' } })
    render(<TopBar />)
    await userEvent.click(screen.getByRole('button', { name: 'File' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'New' }))
    expect(getSheetStore().getState().sheet.name).toBe('Untitled sheet')
  })
})
