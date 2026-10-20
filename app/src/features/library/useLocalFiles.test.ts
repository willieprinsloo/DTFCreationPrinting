import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../platform/tauri', () => ({ cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
import { useLocalFiles } from './useLocalFiles'
import { importLocalFile } from '../../platform/tauri'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

const asset = (id: string, w: number, h: number) => ({ assetId: id, path: `/${id}.png`, previewPath: `/${id}.jpg`, widthPx: w, heightPx: h })

beforeEach(() => {
  vi.clearAllMocks()
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
})

describe('useLocalFiles.addPaths', () => {
  it('adds at native size assuming 300 dpi with a local source', async () => {
    vi.mocked(importLocalFile).mockResolvedValue(asset('a1', 3543, 1772))
    const { result } = renderHook(() => useLocalFiles())
    await act(() => result.current.addPaths(['/x/logo.PNG']))
    const items = getSheetStore().getState().sheet.items
    expect(items).toHaveLength(1)
    expect(items[0].widthMm).toBeCloseTo(300, 0)
    expect(items[0].source).toEqual({ kind: 'local', id: 'a1', label: 'logo.PNG' })
  })

  it('skips unsupported extensions with a message', async () => {
    const { result } = renderHook(() => useLocalFiles())
    await act(() => result.current.addPaths(['/x/notes.docx']))
    expect(importLocalFile).not.toHaveBeenCalled()
    expect(result.current.error).toBe('Only PNG, JPEG, TIFF and PDF files can be added')
    expect(getSheetStore().getState().sheet.items).toHaveLength(0)
  })

  it('adds a PDF at its page size', async () => {
    vi.mocked(importLocalFile).mockResolvedValue({ ...asset('p1', 827, 591), kind: 'pdf', widthMm: 70, heightMm: 50 })
    const { result } = renderHook(() => useLocalFiles())
    await act(() => result.current.addPaths(['/x/gang sheet.PDF']))
    expect(importLocalFile).toHaveBeenCalledWith('/x/gang sheet.PDF')
    const [it0] = getSheetStore().getState().sheet.items
    expect(it0.widthMm).toBe(70)
    expect(it0.heightMm).toBe(50)
  })

  it('shows "PDF support is not installed" verbatim', async () => {
    vi.mocked(importLocalFile).mockRejectedValue('PDF support is not installed')
    const { result } = renderHook(() => useLocalFiles())
    await act(() => result.current.addPaths(['/x/a.pdf']))
    expect(result.current.error).toBe('PDF support is not installed')
  })

  it('one failure does not block the others', async () => {
    vi.mocked(importLocalFile).mockImplementation(async (p) => {
      if (p.endsWith('bad.png')) throw new Error('corrupt')
      return asset('ok', 300, 300)
    })
    const { result } = renderHook(() => useLocalFiles())
    await act(() => result.current.addPaths(['/x/bad.png', 'C:\\x\\good.jpg']))
    expect(getSheetStore().getState().sheet.items.map((i) => i.source.label)).toEqual(['good.jpg'])
    expect(result.current.error).toBe("Couldn't open bad.png")
  })
})
