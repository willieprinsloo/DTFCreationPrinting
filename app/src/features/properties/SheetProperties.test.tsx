import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SheetProperties } from './SheetProperties'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

beforeEach(() => getSheetStore().getState().newSheet(DEFAULT_PROFILE))
const settings = () => getSheetStore().getState().sheet.settings

describe('SheetProperties', () => {
  it('preset chip 300 sets the printer width', async () => {
    render(<SheetProperties />)
    await userEvent.click(screen.getByRole('button', { name: '300' }))
    expect(settings().widthMm).toBe(300)
  })

  it('rejects margins that leave no printable width and keeps the old ones', async () => {
    render(<SheetProperties />)
    const left = screen.getByLabelText('Left margin')
    await userEvent.clear(left)
    await userEvent.type(left, '300{Enter}')
    expect(settings().margins.leftMm).toBe(300)
    const right = screen.getByLabelText('Right margin')
    await userEvent.clear(right)
    await userEvent.type(right, '300{Enter}')
    expect(screen.getByText('Margins leave no printable width')).toBeInTheDocument()
    expect(settings().margins.rightMm).toBe(5)
  })

  it('with link on, one margin sets all four', async () => {
    render(<SheetProperties />)
    await userEvent.click(screen.getByRole('button', { name: 'Link margins' }))
    const top = screen.getByLabelText('Top margin')
    await userEvent.clear(top)
    await userEvent.type(top, '8')
    await userEvent.tab()
    expect(settings().margins).toEqual({ topMm: 8, rightMm: 8, bottomMm: 8, leftMm: 8 })
  })

  it('does not store a non-positive width', async () => {
    render(<SheetProperties />)
    const w = screen.getByLabelText('Printer width')
    await userEvent.clear(w)
    await userEvent.type(w, '0{Enter}')
    expect(settings().widthMm).toBe(600)
    expect(screen.getByRole('alert')).toHaveTextContent(/^Printer width must be more than 0 mm$/)
  })

  it('does not store a negative margin', async () => {
    render(<SheetProperties />)
    const top = screen.getByLabelText('Top margin')
    await userEvent.clear(top)
    await userEvent.type(top, '-4{Enter}')
    expect(settings().margins.topMm).toBe(5)
    expect(screen.getByRole('alert')).toHaveTextContent('Margins cannot be negative')
  })
})
