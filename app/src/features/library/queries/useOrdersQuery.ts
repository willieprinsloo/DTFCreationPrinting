import { useCallback } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { OrderSummary, Page } from '../../../api/types'
import { usePagedQuery } from './usePagedQuery'

/** The orders API accepts at most 100 per page. */
export const MAX_ORDER_LIMIT = 100

export interface OrdersFilter {
  search: string
  /** One request per status (the API filters on a single status); results are merged newest first. */
  statuses: string[]
  dateFrom?: string
  limit?: number
}

const newestFirst = (a: OrderSummary, b: OrderSummary) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0)

export function useOrdersQuery({ search, statuses, dateFrom, limit }: OrdersFilter) {
  const { client } = useDtfClient()
  const statusKey = statuses.join(',')
  const fetchPage = useCallback(
    async (page: number): Promise<Page<OrderSummary>> => {
      const lim = limit === undefined ? undefined : Math.min(limit, MAX_ORDER_LIMIT)
      const results = await Promise.all(
        statusKey.split(',').map((status) =>
          client.listOrders({ status, search: search || undefined, page, limit: lim, dateFrom, sort: 'created_at', order: 'desc' }),
        ),
      )
      const items = results.flatMap((r) => r.items)
      if (results.length > 1) items.sort(newestFirst)
      return { items, total: results.reduce((n, r) => n + r.total, 0), page, hasNext: results.some((r) => r.hasNext) }
    },
    [client, search, statusKey, dateFrom, limit],
  )
  return usePagedQuery<OrderSummary>(fetchPage)
}
