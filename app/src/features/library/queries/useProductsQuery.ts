import { useCallback } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { ProductSummary } from '../../../api/types'
import { usePagedQuery } from './usePagedQuery'

export interface ProductsFilter { search: string; categoryId: string; status?: string; limit: number }

/** Catalogue products; the API returns them newest first. */
export function useProductsQuery({ search, categoryId, status, limit }: ProductsFilter) {
  const { client } = useDtfClient()
  const fetchPage = useCallback(
    (page: number) =>
      client.listProducts({ page, limit, search: search || undefined, categoryId: categoryId || undefined, status: status || undefined }),
    [client, search, categoryId, status, limit],
  )
  return usePagedQuery<ProductSummary>(fetchPage)
}
