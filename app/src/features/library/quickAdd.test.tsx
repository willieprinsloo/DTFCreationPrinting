import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../platform/tauri', () => ({ thumbSrc: (u: string) => u, cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { useQuickAdd } from './quickAdd'
import { fakeClient, withClient } from './testUtils'
import { cacheAsset } from '../../platform/tauri'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

beforeEach(() => {
  vi.clearAllMocks()
  getSheetStore().getState().newSheet(DEFAULT_PROFILE)
})

describe('useQuickAdd', () => {
  it('passes "PDF support is not installed" through verbatim', async () => {
    vi.mocked(cacheAsset).mockRejectedValue('PDF support is not installed')
    const client = fakeClient({ getProductPrintSource: vi.fn(async () => ({ designUrl: '/d.pdf', sizes: [] })) })
    const { result } = renderHook(() => useQuickAdd(() => 'Tees'), { wrapper: withClient(client) })
    const res = await result.current([{ id: 'p1', name: 'Tee', categoryId: '3', sizes: [] } as never])
    expect(res.error).toBe('PDF support is not installed')
  })
})
