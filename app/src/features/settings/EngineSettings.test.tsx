import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('../../platform/tauri', () => ({ createChartPrn: vi.fn() }))
import { createChartPrn } from '../../platform/tauri'
import { open, save } from '@tauri-apps/plugin-dialog'
import { SettingsDialog } from './SettingsDialog'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'

const saved = () => getSettingsStore().getState().profiles.find((p) => p.id === DEFAULT_PROFILE.id)!

beforeEach(async () => {
  vi.mocked(open).mockReset()
  vi.mocked(save).mockReset()
  vi.mocked(createChartPrn).mockReset()
  await getSettingsStore().getState().upsertProfile(DEFAULT_PROFILE)
})

const page = () => render(<SettingsDialog initialTab="printer-ink" onClose={() => {}} />)

describe('Settings › Printer & ink', () => {
  it('is a tab, opens on the printer profile values with help text', () => {
    page()
    expect(screen.getByRole('tab', { name: 'Printer & ink' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Ink limit (%)')).toHaveValue(280)
    expect(screen.getByLabelText('White density (%)')).toHaveValue(100)
    expect(screen.getByLabelText('White choke (mm)')).toHaveValue(0.2)
    expect(screen.getByLabelText('Lead-in (mm)')).toHaveValue(0)
    expect(screen.getByLabelText('Screening')).toHaveValue('blueNoise')
    expect(screen.getByLabelText('Channel 0 ink')).toHaveValue('K')
    expect(screen.getByLabelText('Channel 5 ink')).toHaveValue('W')
    expect(screen.getByText(/white halo/i)).toBeInTheDocument()
    expect(screen.getByText(/Lower white makes colours look duller on dark garments/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Smooth (fast) — recommended' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fine detail (slower)' })).toBeInTheDocument()
    expect(screen.getByText('Colour profile (ICC file from Maintop or ink supplier)')).toBeInTheDocument()
    for (const n of ['Black', 'Cyan', 'Magenta', 'Yellow', 'White']) expect(screen.getByLabelText(`${n} curve at 25 %`)).toBeInTheDocument()
  })

  it('saves edited values onto the printer profile', async () => {
    page()
    const ink = screen.getByLabelText('Ink limit (%)')
    await userEvent.clear(ink)
    await userEvent.type(ink, '320')
    const choke = screen.getByLabelText('White choke (mm)')
    await userEvent.clear(choke)
    await userEvent.type(choke, '0.4')
    await userEvent.selectOptions(screen.getByLabelText('Screening'), 'errorDiffusion')
    await userEvent.selectOptions(screen.getByLabelText('Channel 0 ink'), 'C')
    await userEvent.selectOptions(screen.getByLabelText('Channel 1 ink'), 'K')
    const mid = screen.getByLabelText('Magenta curve at 50 %')
    await userEvent.clear(mid)
    await userEvent.type(mid, '58')
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    const p = saved()
    expect(p.inkLimitPct).toBe(320)
    expect(p.whiteChokeMm).toBe(0.4)
    expect(p.screening).toBe('errorDiffusion')
    expect(p.channelOrder).toEqual(['C', 'K', 'M', 'Y', 'W', 'W'])
    expect(p.dotGain.M).toEqual([[0.25, 0.25], [0.5, 0.58], [0.75, 0.75]])
    expect(p.dotGain.K).toEqual([])
  })

  it('refuses out-of-range values and a repeated ink, and does not save', async () => {
    page()
    const ink = screen.getByLabelText('Ink limit (%)')
    await userEvent.clear(ink)
    await userEvent.type(ink, '50')
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/100 and 400/)
    expect(saved().inkLimitPct).toBe(280)
    await userEvent.clear(ink)
    await userEvent.type(ink, '280')
    await userEvent.selectOptions(screen.getByLabelText('Channel 0 ink'), 'C')
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/each ink/i)
    expect(saved().channelOrder).toEqual(['K', 'C', 'M', 'Y', 'W', 'W'])
  })

  it('picks an ICC file (icc/icm) and can clear it', async () => {
    vi.mocked(open).mockResolvedValue('/profiles/maintop.icc')
    page()
    expect(screen.getByText('No colour profile — the built-in colour model is used')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose colour profile…' }))
    expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({ multiple: false, filters: [{ extensions: ['icc', 'icm'] }] })
    expect(await screen.findByText('/profiles/maintop.icc')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    await screen.findByRole('status')
    expect(saved().iccProfilePath).toBe('/profiles/maintop.icc')
    await userEvent.click(screen.getByRole('button', { name: 'Remove colour profile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    await screen.findByRole('status')
    expect(saved().iccProfilePath).toBeUndefined()
  })

  it('rejects a blank number with "Enter a number"', async () => {
    page()
    await userEvent.clear(screen.getByLabelText('White choke (mm)'))
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a number')
    await userEvent.clear(screen.getByLabelText('Cyan curve at 25 %'))
    await userEvent.type(screen.getByLabelText('White choke (mm)'), '0.2')
    await userEvent.click(screen.getByRole('button', { name: 'Save printer & ink settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a number')
  })

  it('creates the colour and white charts from the settings on screen', async () => {
    vi.mocked(save).mockResolvedValueOnce('/out/colour.prn').mockResolvedValueOnce('/out/white.prn')
    vi.mocked(createChartPrn).mockResolvedValue({ lines: 10, bytes: 1, millis: 1 })
    page()
    const ink = screen.getByLabelText('Ink limit (%)')
    await userEvent.clear(ink)
    await userEvent.type(ink, '200')
    await userEvent.click(screen.getByRole('button', { name: 'Create colour chart PRN' }))
    expect(await screen.findByText(/Saved .*colour\.prn/)).toBeInTheDocument()
    expect(createChartPrn).toHaveBeenCalledWith('colour', expect.objectContaining({ inkLimitPct: 200 }), '/out/colour.prn')
    await userEvent.click(screen.getByRole('button', { name: 'Create white chart PRN' }))
    expect(await screen.findByText(/Saved .*white\.prn/)).toBeInTheDocument()
    expect(createChartPrn).toHaveBeenLastCalledWith('white', expect.objectContaining({ inkLimitPct: 200 }), '/out/white.prn')
  })

  it('shows the error when chart creation fails, and does nothing if Save as is cancelled', async () => {
    vi.mocked(save).mockResolvedValueOnce(null).mockResolvedValueOnce('/out/c.prn')
    vi.mocked(createChartPrn).mockRejectedValue(new Error('disk full'))
    page()
    await userEvent.click(screen.getByRole('button', { name: 'Create colour chart PRN' }))
    expect(createChartPrn).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Create colour chart PRN' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
  })

  it('disables both chart buttons while a chart is being made and clears the last error when starting again', async () => {
    vi.mocked(save).mockResolvedValue('/out/c.prn')
    vi.mocked(createChartPrn).mockRejectedValueOnce(new Error('disk full'))
    page()
    const colour = screen.getByRole('button', { name: 'Create colour chart PRN' })
    const white = screen.getByRole('button', { name: 'Create white chart PRN' })
    await userEvent.click(colour)
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')

    let finish!: (v: { lines: number; bytes: number; millis: number }) => void
    vi.mocked(createChartPrn).mockImplementationOnce(() => new Promise((r) => (finish = r)))
    await userEvent.click(white)
    expect(await screen.findByText('Creating the white chart…')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(colour).toBeDisabled()
    expect(white).toBeDisabled()
    await userEvent.click(colour)
    expect(createChartPrn).toHaveBeenCalledTimes(2)
    act(() => finish({ lines: 1, bytes: 1, millis: 1 }))
    await waitFor(() => expect(colour).toBeEnabled())
    expect(white).toBeEnabled()
  })
})
