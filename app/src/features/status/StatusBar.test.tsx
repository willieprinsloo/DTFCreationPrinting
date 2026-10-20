import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { StatusBar } from './StatusBar'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

const asset = { assetId: 'a', path: '/a.png', previewPath: '/a.jpg', widthPx: 3000, heightPx: 3000 }
const source = { kind: 'local' as const, id: 's', label: 'x' }

beforeEach(() => getSheetStore().getState().newSheet(DEFAULT_PROFILE))

describe('StatusBar', () => {
  it('shows film size and design count', () => {
    act(() => getSheetStore().getState().addItems([{ asset, source, widthMm: 100, heightMm: 100, quantity: 1 }]))
    render(<StatusBar />)
    expect(screen.getByText('Film 60 × 11 cm')).toBeInTheDocument()
    expect(screen.getByText('1 design')).toBeInTheDocument()
    expect(screen.getByText(/Used \d+%/)).toBeInTheDocument()
    expect(screen.queryByText(/low-res/)).toBeNull()
  })

  it('flags low-res designs and problems', () => {
    act(() => {
      const s = getSheetStore().getState()
      s.addItems([{ asset, source, widthMm: 1000, heightMm: 100, quantity: 1 }])
      s.updateItem(getSheetStore().getState().sheet.items[0].id, { rotationDeg: 0, xMm: 0, yMm: 5 })
    })
    render(<StatusBar />)
    expect(screen.getByText('⚠ 1 low-res')).toBeInTheDocument()
    expect(screen.getByText('⛔ 1 problems')).toBeInTheDocument()
  })

  it('shows exact used percentage', () => {
    act(() => getSheetStore().getState().addItems([{ asset, source, widthMm: 100, heightMm: 100, quantity: 1 }]))
    render(<StatusBar />)
    // 10000 mm2 / (590 x (110 - 10)) mm2 = 16.9%
    expect(screen.getByText('Used 17%')).toBeInTheDocument()
  })

  it('counts distinct orders', () => {
    act(() => {
      const s = getSheetStore().getState()
      s.addItems([{ asset, source: { ...source, orderId: 'o1' }, widthMm: 50, heightMm: 50, quantity: 2 }])
      s.addItems([{ asset, source: { ...source, id: 's2', orderId: 'o2' }, widthMm: 50, heightMm: 50, quantity: 1 }])
    })
    render(<StatusBar />)
    expect(screen.getByText('3 designs')).toBeInTheDocument()
    expect(screen.getByText('2 orders')).toBeInTheDocument()
  })
})
