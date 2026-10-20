import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../state/persist', async (orig) => {
  const m = await orig<typeof import('../../state/persist')>()
  return { ...m, createTauriStore: () => m.createMemoryStore() }
})
import { SettingsDialog } from './SettingsDialog'
import { fakeClient, withClient } from '../library/testUtils'
import { getSettingsStore } from '../../state/settingsStore'

const categories = vi.fn(async () => [
  { id: '3', name: 'T-Shirts' },
  { id: '4', name: 'Mugs' },
])

function openPage() {
  render(<SettingsDialog initialTab="print-sizes" onClose={() => {}} />, { wrapper: withClient(fakeClient({ listProductCategories: categories })) })
}

beforeEach(async () => {
  await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { L: 300 } } })
})

describe('Settings › Print sizes', () => {
  it('opens on the Print sizes tab with the help line and a row per product type', async () => {
    openPage()
    expect(screen.getByRole('tab', { name: 'Print sizes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Width the design is printed at for each garment size. Height follows the design.')).toBeInTheDocument()
    expect(await screen.findByRole('rowheader', { name: 'T-Shirts' })).toBeInTheDocument()
    expect(screen.getByLabelText('T-Shirts L width (cm)')).toHaveValue(30)
    expect(screen.getByLabelText('T-Shirts M width (cm)')).toHaveValue(null)
    expect(screen.getByLabelText('Mugs One size width (cm)')).toBeInTheDocument()
  })

  it('saves a width (cm → mm) on blur, clears a blank cell, and changes the default size', async () => {
    openPage()
    const m = await screen.findByLabelText('T-Shirts M width (cm)')
    await userEvent.type(m, '28')
    expect(getSettingsStore().getState().printSizes.byType['3'].M).toBeUndefined()
    await userEvent.tab()
    expect(getSettingsStore().getState().printSizes.byType['3']).toEqual({ M: 280, L: 300 })
    await userEvent.clear(screen.getByLabelText('T-Shirts L width (cm)'))
    await userEvent.tab()
    expect(getSettingsStore().getState().printSizes.byType['3']).toEqual({ M: 280 })
    await userEvent.selectOptions(screen.getByLabelText('Default size'), 'L')
    expect(getSettingsStore().getState().printSizes.defaultSize).toBe('L')
  })

  it('rejects zero and widths wider than the printer, without saving', async () => {
    openPage()
    const m = await screen.findByLabelText('T-Shirts M width (cm)')
    await userEvent.type(m, '0')
    await userEvent.tab()
    expect(screen.getByRole('alert')).toHaveTextContent('more than 0')
    await userEvent.clear(m)
    await userEvent.type(m, '61')
    await userEvent.tab()
    expect(screen.getByRole('alert')).toHaveTextContent('60 cm')
    expect(getSettingsStore().getState().printSizes.byType['3']).toEqual({ L: 300 })
  })

  it('"One size only" shows just the One size column for that type and is kept', async () => {
    openPage()
    const row = (await screen.findByRole('rowheader', { name: 'Mugs' })).closest('tr')!
    expect(within(row).getAllByRole('spinbutton')).toHaveLength(10)
    await userEvent.click(within(row).getByRole('checkbox', { name: 'Mugs: One size only' }))
    expect(within(row).getAllByRole('spinbutton')).toHaveLength(1)
    await userEvent.type(within(row).getByLabelText('Mugs One size width (cm)'), '9')
    await userEvent.tab()
    expect(getSettingsStore().getState().printSizes.byType['4']).toEqual({ 'One size': 90 })
  })

  it('remembers "One size only" on reopen, and turning it on clears that type\'s per-size widths', async () => {
    await getSettingsStore().getState().setPrintSizes({ defaultSize: 'M', byType: { '3': { L: 300, 'One size': 250 }, '4': { 'One size': 90 } } })
    openPage()
    const mugs = (await screen.findByRole('rowheader', { name: 'Mugs' })).closest('tr')!
    await waitFor(() => expect(within(mugs).getByRole('checkbox', { name: 'Mugs: One size only' })).toBeChecked())
    expect(within(mugs).getAllByRole('spinbutton')).toHaveLength(1)
    const tees = screen.getByRole('rowheader', { name: 'T-Shirts' }).closest('tr')!
    await userEvent.click(within(tees).getByRole('checkbox', { name: 'T-Shirts: One size only' }))
    expect(getSettingsStore().getState().printSizes.byType['3']).toEqual({ 'One size': 250 })
  })
})
