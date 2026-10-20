import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('../../platform/tauri', () => ({ createChartPrn: vi.fn() }))
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
