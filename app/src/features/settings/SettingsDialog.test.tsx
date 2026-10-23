import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('../../platform/tauri', () => ({ thumbSrc: (u: string) => u, createChartPrn: vi.fn() }))
import { SettingsDialog } from './SettingsDialog'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'

const store = () => getSettingsStore().getState()

beforeEach(async () => {
  await store().upsertProfile(DEFAULT_PROFILE)
  await store().setThresholds({ fine: 200, low: 150 })
  await store().setMinPreviewLength(1000)
})

describe('Settings › Printers', () => {
  it('opens first and lists printers in plain words', () => {
    render(<SettingsDialog onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Printers' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(`${DEFAULT_PROFILE.name}`)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${DEFAULT_PROFILE.widthMm / 10} cm film`))).toBeInTheDocument()
  })

  it('edits a printer and saves it', async () => {
    render(<SettingsDialog onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: `Edit ${DEFAULT_PROFILE.name}` }))
    const gap = screen.getByLabelText('Space between designs (mm)')
    await userEvent.clear(gap)
    await userEvent.type(gap, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save printer' }))
    expect(store().profiles.find((p) => p.id === DEFAULT_PROFILE.id)?.defaultGapMm).toBe(4)
    expect(screen.getByRole('button', { name: 'Add printer' })).toBeInTheDocument()
  })

  it('explains margins that leave no room to print', async () => {
    render(<SettingsDialog onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: `Edit ${DEFAULT_PROFILE.name}` }))
    const left = screen.getByLabelText('Left margin (mm)')
    await userEvent.clear(left)
    await userEvent.type(left, '9999')
    await userEvent.click(screen.getByRole('button', { name: 'Save printer' }))
    expect(screen.getByRole('alert')).toHaveTextContent('no room to print')
  })
})

describe('Settings › Ink & colour', () => {
  it('keeps changes when Done is pressed without Save (the colour profile stays removed)', async () => {
    await store().upsertProfile({ ...DEFAULT_PROFILE, iccProfilePath: 'C:/driver/720x1800_6paaas.icm' })
    const onClose = vi.fn()
    const { unmount } = render(<SettingsDialog initialTab="printer-ink" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove colour profile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
    expect(store().profiles.find((p) => p.id === DEFAULT_PROFILE.id)?.iccProfilePath).toBeUndefined()
    unmount()
    render(<SettingsDialog initialTab="printer-ink" onClose={() => {}} />)
    expect(screen.getByText(/No colour profile/)).toBeInTheDocument()
  })

  it('keeps changes when another tab is opened', async () => {
    render(<SettingsDialog initialTab="printer-ink" onClose={() => {}} />)
    const ink = screen.getByLabelText('Ink limit (%)')
    await userEvent.clear(ink)
    await userEvent.type(ink, '300')
    await userEvent.click(screen.getByRole('tab', { name: 'General' }))
    expect(store().profiles.find((p) => p.id === DEFAULT_PROFILE.id)?.inkLimitPct).toBe(300)
  })

  it('stays open and says why when a value cannot be saved', async () => {
    const onClose = vi.fn()
    render(<SettingsDialog initialTab="printer-ink" onClose={onClose} />)
    const ink = screen.getByLabelText('Ink limit (%)')
    await userEvent.clear(ink)
    await userEvent.type(ink, '50')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/ink limit must be between 100 and 400/i)).toBeInTheDocument()
    expect(store().profiles.find((p) => p.id === DEFAULT_PROFILE.id)?.inkLimitPct).toBe(DEFAULT_PROFILE.inkLimitPct)
  })

  it('closes without writing anything when nothing was changed', async () => {
    const before = JSON.stringify(store().profiles)
    const onClose = vi.fn()
    render(<SettingsDialog initialTab="printer-ink" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
    expect(JSON.stringify(store().profiles)).toBe(before)
  })
})

describe('Settings › General', () => {
  it('saves quality warnings and empty sheet length with one button', async () => {
    render(<SettingsDialog initialTab="general" onClose={() => {}} />)
    const good = screen.getByLabelText('Good from (dpi)')
    await userEvent.clear(good)
    await userEvent.type(good, '250')
    const len = screen.getByLabelText('Empty sheet length (cm)')
    await userEvent.clear(len)
    await userEvent.type(len, '50')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(store().thresholds).toEqual({ fine: 250, low: 150 })
    expect(store().minPreviewLengthMm).toBe(500)
  })

  it('refuses warnings the wrong way round', async () => {
    render(<SettingsDialog initialTab="general" onClose={() => {}} />)
    const low = screen.getByLabelText('Too low below (dpi)')
    await userEvent.clear(low)
    await userEvent.type(low, '300')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('must not be higher')
    expect(store().thresholds).toEqual({ fine: 200, low: 150 })
  })
})

describe('Settings › General › Appearance', () => {
  it('switches light and dark right away, and back to following the computer', async () => {
    const { installTheme } = await import('../../state/theme')
    installTheme()
    render(<SettingsDialog initialTab="general" onClose={() => {}} />)
    const look = within(screen.getByRole('group', { name: 'Appearance' }))
    await userEvent.click(look.getByRole('button', { name: 'Dark' }))
    expect(store().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(look.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(look.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    await userEvent.click(look.getByRole('button', { name: 'Same as this computer' }))
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('shows the film dark or white, apart from the app look', async () => {
    await store().setFilmShade('light')
    render(<SettingsDialog initialTab="general" onClose={() => {}} />)
    const film = within(screen.getByRole('group', { name: 'Film behind the designs' }))
    await userEvent.click(film.getByRole('button', { name: 'Dark' }))
    expect(store().filmShade).toBe('dark')
    expect(film.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(film.getByRole('button', { name: 'White' }))
    expect(store().filmShade).toBe('light')
  })
})
