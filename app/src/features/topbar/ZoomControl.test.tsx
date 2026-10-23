import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { ZoomControl } from './ZoomControl'
import { getViewportStore } from '../canvas/useViewport'
import { getSettingsStore } from '../../state/settingsStore'

const PX = 4

beforeEach(() => {
  getSettingsStore().setState({ screenPxPerMm: PX })
  getViewportStore().setState({ vp: { scale: PX * 0.5, offsetX: 0, offsetY: 0 }, viewW: 800, viewH: 600 })
})

describe('ZoomControl', () => {
  it('shows 100% as true physical size', () => {
    render(<ZoomControl />)
    expect(screen.getByLabelText('Zoom percentage')).toHaveValue('50%')
    act(() => getViewportStore().setState({ vp: { scale: PX, offsetX: 0, offsetY: 0 } }))
    expect(screen.getByLabelText('Zoom percentage')).toHaveValue('100%')
  })

  it('switches the film between white and dark', async () => {
    getSettingsStore().setState({ filmShade: 'light' })
    render(<ZoomControl />)
    await userEvent.click(screen.getByRole('button', { name: 'Show the film dark' }))
    expect(getSettingsStore().getState().filmShade).toBe('dark')
    await userEvent.click(screen.getByRole('button', { name: 'Show the film white' }))
    expect(getSettingsStore().getState().filmShade).toBe('light')
  })

  it('typing 200 sets the zoom to twice true size', async () => {
    render(<ZoomControl />)
    const input = screen.getByLabelText('Zoom percentage')
    await userEvent.clear(input)
    await userEvent.type(input, '200{Enter}')
    expect(getViewportStore().getState().vp.scale).toBeCloseTo(2 * PX)
  })
})
