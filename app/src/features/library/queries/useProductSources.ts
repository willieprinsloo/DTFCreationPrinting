import { useCallback } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import { AuthRequiredError, type DtfClient } from '../../../api/dtfClient'
import type { ProductPrintSource, ProductSummary } from '../../../api/types'
import { createLazyLoader, useLoader, type LazyLoader } from './useLazyDetails'

const MAX_CONCURRENT = 4

// One loader per client, so the drawer, the pop-out browser and the add dialog share a single
// cache and never fetch the same product twice.
const loaders = new WeakMap<DtfClient, LazyLoader<ProductPrintSource>>()
function loaderFor(client: DtfClient) {
  let l = loaders.get(client)
  if (!l) {
    l = createLazyLoader((id: string) => client.getProductPrintSource(id), MAX_CONCURRENT)
    loaders.set(client, l)
  }
  return l
}

/**
 * Lazily loaded, cached print sources (the raw design file) per product id. `get` is the shared
 * fetch for dialogs / quick-add (rejects on failure); `prefetch` is for thumbnails (asks for
 * sign-in on auth errors, otherwise leaves the placeholder).
 */
export function useProductSources() {
  const { client, requireLogin } = useDtfClient()
  const loader = loaderFor(client)
  const sources = useLoader(loader)

  const prefetch = useCallback(
    (id: string) => {
      if (loader.peek(id)) return
      loader.get(id).catch((e) => {
        if (e instanceof AuthRequiredError) requireLogin()
      })
    },
    [loader, requireLogin],
  )

  /** Absolute URL of the raw design, or '' while loading / when the product has none. Never the mockup. */
  const designSrc = (p: ProductSummary) => {
    const url = sources[p.id]?.designUrl
    return url ? client.absoluteUrl(url) : ''
  }
  const hasNoDesign = (id: string) => sources[id]?.designUrl === null

  return { sources, get: loader.get, peek: loader.peek, prefetch, designSrc, hasNoDesign }
}
