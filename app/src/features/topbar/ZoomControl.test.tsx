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

  it('typing 200 sets the zoom to twice true size', async () => {
    render(<ZoomControl />)
    const input = screen.getByLabelText('Zoom percentage')
    await userEvent.clear(input)
    await userEvent.type(input, '200{Enter}')
    expect(getViewportStore().getState().vp.scale).toBeCloseTo(2 * PX)
  })
})
