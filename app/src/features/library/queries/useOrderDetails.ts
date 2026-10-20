import { useCallback, useRef, useState } from 'react'
import { useLazyDetails } from './useLazyDetails'
import { useDtfClient } from '../../../api/DtfClientContext'
import { AuthRequiredError } from '../../../api/dtfClient'
import type { OrderSummary } from '../../../api/types'

const MAX_FILE_REQUESTS = 4

/**
 * Per-order files and customer names, loaded lazily and cached. File requests share a pool of
 * 4 concurrent slots (see useLazyDetails); failed requests are forgotten so they can be retried.
 */
export function useOrderDetails() {
  const { client, requireLogin } = useDtfClient()
  const [customers, setCustomers] = useState<Record<string, string>>({})
  const customerReqs = useRef(new Map<string, Promise<void>>())
  const { values: files, get: loadFiles } = useLazyDetails((orderId: string) => client.getOrderFiles(orderId), { concurrency: MAX_FILE_REQUESTS })

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
