import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { DtfClientContext } from '../../api/DtfClientContext'
import type { DtfClient } from '../../api/dtfClient'

export function fakeClient(over: Partial<DtfClient> = {}): DtfClient {
  return {
    login: vi.fn(async () => {}),
    listGalleryDesigns: vi.fn(async () => ({ items: [], total: 0, page: 1, hasNext: false })),
    listGalleryCategories: vi.fn(async () => []),
    listCustomers: vi.fn(async () => []),
    listOrders: vi.fn(async () => ({ items: [], total: 0, page: 1, hasNext: false })),
    getOrderFiles: vi.fn(async () => []),
    setOrderStatus: vi.fn(async () => {}),
    absoluteUrl: (p: string) => `https://x.test${p}`,
    token: () => 'tok',
    ...over,
  }
}

export function withClient(client: DtfClient, requireLogin = vi.fn()) {
  return ({ children }: { children: ReactNode }) => (
    <DtfClientContext.Provider value={{ client, requireLogin }}>{children}</DtfClientContext.Provider>
  )
}
