import type { SourceRef } from './types'

/**
 * The DTF Creations page where a placed design is edited: the product, the catalogue design, or
 * the order its print file came from. Null for files from this computer (they have no page).
 * `apiBaseUrl` is the server address from Settings (…/api/v1); the pages are on the same site.
 */
export function editPageUrl(source: SourceRef, apiBaseUrl: string): string | null {
  let origin: string
  try {
    origin = new URL(apiBaseUrl).origin
  } catch {
    return null
  }
  const id = encodeURIComponent
  if (source.productId) return `${origin}/admin/catalogue/products/${id(source.productId)}`
  if (source.kind === 'order-file') return source.orderId ? `${origin}/admin/orders/${id(source.orderId)}` : null
  if (source.kind === 'gallery') return `${origin}/admin/gallery?edit=${id(source.id)}`
  return null
}
