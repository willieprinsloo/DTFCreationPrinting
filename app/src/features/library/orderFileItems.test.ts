import { describe, expect, it, vi } from 'vitest'

vi.mock('../../platform/tauri', () => ({ thumbSrc: (u: string) => u, cacheAsset: vi.fn(), importLocalFile: vi.fn(), assetSrc: (p: string) => p }))
import { downloadOrderFiles } from './orderFileItems'
import { fakeClient } from './testUtils'
import { cacheAsset } from '../../platform/tauri'
import type { OrderFile, OrderSummary } from '../../api/types'

const order = { id: 'o1', orderNumber: 'A1' } as OrderSummary
const file = (itemId: string, url: string) => ({ itemId, printFileUrl: url, sizeLabel: itemId }) as unknown as OrderFile
const ref = (f: OrderFile) => ({ order, file: f, customerName: 'Jo', key: f.itemId })

describe('downloadOrderFiles', () => {
  it('passes "PDF support is not installed" through verbatim', async () => {
    vi.mocked(cacheAsset).mockRejectedValue('PDF support is not installed')
    const res = await downloadOrderFiles(fakeClient(), [ref(file('f1', '/a.pdf'))])
    expect(res.error).toBe('PDF support is not installed')
  })

  it('reports other failures as download failures', async () => {
    vi.mocked(cacheAsset).mockRejectedValue(new Error('boom'))
    const res = await downloadOrderFiles(fakeClient(), [ref(file('f1', '/a.png'))])
    expect(res.error).toBe("Couldn't download A1 f1: boom")
  })
})
