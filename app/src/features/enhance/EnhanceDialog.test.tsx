import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EnhanceDialog } from './EnhanceDialog'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'
import type { Asset } from '../../domain/types'

vi.mock('../../platform/tauri', () => {
  class EnhanceCancelledError extends Error {}
  return { enhanceAsset: vi.fn(), assetSrc: (p: string) => `asset://${p}`, EnhanceCancelledError }
})
import { enhanceAsset, EnhanceCancelledError } from '../../platform/tauri'

const low: Asset = { assetId: 'a', path: '/cache/a.png', previewPath: '/cache/a.preview.png', widthPx: 1000, heightPx: 500 }
const enhanced: Asset = { assetId: 'a3', path: '/cache/a3.png', previewPath: '/cache/a3.preview.png', widthPx: 3000, heightPx: 1500 }

/** Makes enhanceAsset hand back a job the test settles by hand. */
function controlledJob() {
  const ctl = {} as { progress(f: number): void; resolve(a: Asset): void; reject(e: unknown): void; cancel: ReturnType<typeof vi.fn<() => void>> }
  ctl.cancel = vi.fn<() => void>()
  vi.mocked(enhanceAsset).mockImplementation((_a, _w, _h, _k, onProgress) => {
    ctl.progress = onProgress
    const promise = new Promise<Asset>((res, rej) => {
      ctl.resolve = res
      ctl.reject = rej
    })
    return { promise, cancel: ctl.cancel }
  })
  return ctl
}

/** Two copies of a 1000 px design printed 25.4 cm wide (100 dpi). */
function setup() {
  const s = getSheetStore()
  s.getState().newSheet(DEFAULT_PROFILE)
  s.getState().addItems([{ asset: low, source: { kind: 'local', id: 'a', label: 'Logo' }, widthMm: 254, heightMm: 127, quantity: 2 }])
  const item = s.getState().sheet.items[0]
  const onClose = vi.fn()
  render(<EnhanceDialog item={item} onClose={onClose} />)
  return { onClose }
}

beforeEach(() => vi.mocked(enhanceAsset).mockReset())

describe('EnhanceDialog', () => {
  it('enlarges to 300 dpi as artwork, shows before and after, and swaps every copy in on Use', async () => {
    const ctl = controlledJob()
    const { onClose } = setup()
    expect(screen.getByText(/prints at 100 dpi/)).toBeInTheDocument()
    expect(screen.getByText(/1000 × 500 → 3000 × 1500 px/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enhance' }))
    expect(enhanceAsset).toHaveBeenCalledWith(low, 3000, 1500, 'artwork', expect.any(Function))
    act(() => ctl.progress(0.4))
    expect(screen.getByRole('progressbar', { name: 'Enhancing' })).toHaveAttribute('value', '0.4')
    await act(async () => ctl.resolve(enhanced))
    expect(screen.getByRole('img', { name: 'Before, zoomed in' }).style.backgroundImage).toContain('asset:///cache/a.png')
    expect(screen.getByRole('img', { name: 'After, zoomed in' }).style.backgroundImage).toContain('asset:///cache/a3.png')
    expect(screen.getByText(/All 2 copies on this sheet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use enhanced' }))
    expect(getSheetStore().getState().sheet.items.map((i) => i.asset.assetId)).toEqual(['a3', 'a3'])
    expect(onClose).toHaveBeenCalled()
  })

  it('uses the photo model when asked, and Keep original leaves the sheet alone', async () => {
    const ctl = controlledJob()
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Photos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enhance' }))
    expect(enhanceAsset).toHaveBeenCalledWith(low, 3000, 1500, 'photo', expect.any(Function))
    await act(async () => ctl.resolve(enhanced))
    await userEvent.click(screen.getByRole('button', { name: 'Keep original' }))
    expect(getSheetStore().getState().sheet.items.map((i) => i.asset.assetId)).toEqual(['a', 'a'])
  })

  it('shows why it failed, and says nothing when cancelled', async () => {
    let ctl = controlledJob()
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Enhance' }))
    await act(async () => ctl.reject(new Error('Enhance needs a graphics card with Vulkan support')))
    expect(screen.getByRole('alert')).toHaveTextContent('Vulkan')
    ctl = controlledJob()
    await userEvent.click(screen.getByRole('button', { name: 'Enhance' }))
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(ctl.cancel).toHaveBeenCalled()
    await act(async () => ctl.reject(new EnhanceCancelledError('Cancelled')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled()
  })
})
