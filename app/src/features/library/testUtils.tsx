import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { DtfClientContext } from '../../api/DtfClientContext'
import type { DtfClient } from '../../api/dtfClient'
import { DEFAULT_PRINT_SIZES } from '../../domain/printSizes'

const noPrintSizes = { revision: 0, printSizes: DEFAULT_PRINT_SIZES, otherPositions: {} }

export function fakeClient(over: Partial<DtfClient> = {}): DtfClient {
  return {
    login: vi.fn(async () => {}),
    listGalleryDesigns: vi.fn(async () => ({ items: [], total: 0, page: 1, hasNext: false })),
    listGalleryCategories: vi.fn(async () => []),
    listProductCategories: vi.fn(async () => []),
    listProducts: vi.fn(async () => ({ items: [], total: 0, page: 1, hasNext: false })),
    getProductPrintSource: vi.fn(async () => ({ designUrl: null, sizes: [] })),
    listCustomers: vi.fn(async () => []),
    getCustomer: vi.fn(async (id: string) => ({ id, name: '', email: '' })),
    listOrders: vi.fn(async () => ({ items: [], total: 0, page: 1, hasNext: false })),
    getOrderFiles: vi.fn(async () => []),
    getOrderStatus: vi.fn(async () => 'confirmed'),
    setOrderStatus: vi.fn(async () => {}),
    getPrintSizes: vi.fn(async () => noPrintSizes),
    putPrintSizeType: vi.fn(async () => noPrintSizes),
    setDefaultPrintSize: vi.fn(async () => noPrintSizes),
    importPrintSizes: vi.fn(async () => noPrintSizes),
    absoluteUrl: (p: string) => `https://x.test${p}`,
    token: () => 'tok',
    bearerFor: (u: string) => (u.startsWith('https://x.test/') ? 'tok' : undefined),
    ...over,
  }
}

export function withClient(client: DtfClient, requireLogin = vi.fn()) {
  return ({ children }: { children: ReactNode }) => (
    <DtfClientContext.Provider value={{ client, requireLogin }}>{children}</DtfClientContext.Provider>
  )
}
