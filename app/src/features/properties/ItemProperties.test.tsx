import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ItemProperties } from './ItemProperties'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

const asset = { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 1500 }
const source = { kind: 'local' as const, id: 's', label: 'Logo.png', customerName: 'Jo', orderNumber: 'A12', orderId: 'o1' }
let id = ''

beforeEach(() => {
  const s = getSheetStore().getState()
  s.newSheet(DEFAULT_PROFILE)
  s.addItems([{ asset, source, widthMm: 254, heightMm: 127, quantity: 1 }])
  id = getSheetStore().getState().sheet.items[0].id
})
const item = () => getSheetStore().getState().sheet.items[0]

describe('ItemProperties', () => {
  it('shows dpi and quality label', () => {
    render(<ItemProperties ids={[id]} />)
    expect(screen.getByText('300 dpi')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('Logo.png')).toBeInTheDocument()
    expect(screen.getByText('Jo')).toBeInTheDocument()
  })

  it('keeps aspect when width changes', async () => {
    render(<ItemProperties ids={[id]} />)
    const w = screen.getByLabelText('Width')
    await userEvent.clear(w)
    await userEvent.type(w, '50.8{Enter}')
    expect(item().widthMm).toBeCloseTo(508)
    expect(item().heightMm).toBeCloseTo(254)
  })

  it('rotates by 90 and duplicates / deletes', async () => {
    render(<ItemProperties ids={[id]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }))
    expect(item().rotationDeg).toBe(90)
    await userEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    expect(getSheetStore().getState().sheet.items).toHaveLength(2)
  })

  it('multi-select shows count and only Duplicate/Delete', () => {
    render(<ItemProperties ids={['x', 'y']} />)
    expect(screen.getByText('2 designs selected')).toBeInTheDocument()
    expect(screen.queryByLabelText('Width')).toBeNull()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument()
  })
})
