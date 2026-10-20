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
