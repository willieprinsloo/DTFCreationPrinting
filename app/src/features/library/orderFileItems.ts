import type { DtfClient } from '../../api/dtfClient'
import { AuthRequiredError } from '../../api/dtfClient'
import type { OrderFile, OrderSummary } from '../../api/types'
import { cacheAsset } from '../../platform/tauri'
import type { NewItem } from '../../state/sheetStore'

export interface OrderFileRef { order: OrderSummary; file: OrderFile; customerName: string; key: string }
export interface DownloadResult { items: NewItem[]; done: string[]; failed: string[]; authFailed: boolean }

export const orderFileKey = (orderId: string, f: OrderFile) => `${orderId}:${f.itemId}`

/** Downloads each order file and builds a sheet item at native size (300 dpi). Failures are reported, not thrown. */
export async function downloadOrderFiles(client: DtfClient, refs: OrderFileRef[]): Promise<DownloadResult> {
  const out: DownloadResult = { items: [], done: [], failed: [], authFailed: false }
  for (const { order: o, file: f, customerName, key } of refs) {
    try {
      const url = client.absoluteUrl(f.printFileUrl)
      const asset = await cacheAsset(url, client.bearerFor(url))
      out.done.push(key)
      out.items.push({
        asset,
        source: {
          kind: 'order-file',
          id: f.itemId,
          label: `${o.orderNumber} ${f.sizeLabel}`,
          orderId: o.id,
          orderNumber: o.orderNumber,
          customerName,
        },
        widthMm: (asset.widthPx / 300) * 25.4,
        heightMm: (asset.heightPx / 300) * 25.4,
        quantity: 1,
      })
    } catch (e) {
      if (e instanceof AuthRequiredError) out.authFailed = true
      out.failed.push(`${o.orderNumber} ${f.sizeLabel}`)
    }
  }
  return out
}
