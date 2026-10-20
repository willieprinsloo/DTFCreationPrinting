import { useCallback, useRef, useState } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import { AuthRequiredError } from '../../../api/dtfClient'
import type { OrderFile, OrderSummary } from '../../../api/types'

const MAX_FILE_REQUESTS = 4

/**
 * Per-order files and customer names, loaded lazily and cached. File requests share a pool of
 * 4 concurrent slots; failed requests are forgotten so they can be retried.
 */
export function useOrderDetails() {
  const { client, requireLogin } = useDtfClient()
  const [files, setFiles] = useState<Record<string, OrderFile[]>>({})
  const [customers, setCustomers] = useState<Record<string, string>>({})
  const customerReqs = useRef(new Map<string, Promise<void>>())
  const fileReqs = useRef(new Map<string, Promise<OrderFile[]>>())
  const slots = useRef({ active: 0, waiting: [] as Array<() => void> })

  const withSlot = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const s = slots.current
    if (s.active >= MAX_FILE_REQUESTS) await new Promise<void>((r) => s.waiting.push(r))
    else s.active++
    try {
      return await fn()
    } finally {
      // Hand the slot straight to the next waiter so the count never dips and lets a 5th in.
      const next = s.waiting.shift()
      if (next) next()
      else s.active--
    }
  }, [])

  const loadFiles = useCallback(
    (orderId: string): Promise<OrderFile[]> => {
      let p = fileReqs.current.get(orderId)
      if (!p) {
        p = withSlot(() => client.getOrderFiles(orderId)).then((list) => {
          setFiles((cur) => ({ ...cur, [orderId]: list }))
          return list
        })
        p.catch(() => {
          fileReqs.current.delete(orderId)
        })
        fileReqs.current.set(orderId, p)
      }
      return p
    },
    [client, withSlot],
  )

  const loadCustomer = useCallback(
    (customerId: string | undefined) => {
      if (!customerId || customerReqs.current.has(customerId)) return
      customerReqs.current.set(
        customerId,
        client.getCustomer(customerId).then(
          (c) => {
            if (c.name) setCustomers((cur) => ({ ...cur, [customerId]: c.name }))
          },
          (e) => {
            customerReqs.current.delete(customerId)
            if (e instanceof AuthRequiredError) requireLogin()
          },
        ),
      )
    },
    [client, requireLogin],
  )

  /** Customer + files for an order that scrolled into view; auth failures ask for sign-in. */
  const prefetch = useCallback(
    (o: OrderSummary) => {
      loadCustomer(o.customerId)
      loadFiles(o.id).catch((e) => {
        if (e instanceof AuthRequiredError) requireLogin()
      })
    },
    [loadCustomer, loadFiles, requireLogin],
  )

  const customerName = useCallback(
    (o: OrderSummary) => (o.customerId && customers[o.customerId]) || o.customerName,
    [customers],
  )

  return { files, customers, loadFiles, loadCustomer, prefetch, customerName }
}
