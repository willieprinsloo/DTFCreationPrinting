import type { DtfClient } from '../../api/dtfClient'
import { AuthRequiredError } from '../../api/dtfClient'
import type { OrderFile, OrderSummary } from '../../api/types'
import { nativeSizeMm } from '../../domain/dpi'
import { cacheAsset } from '../../platform/tauri'
import { PDF_NOT_INSTALLED, isPdfNotInstalled } from './pdfSupport'
import { downloadFailedText } from './format'
import type { NewItem } from '../../state/sheetStore'

export interface OrderFileRef { order: OrderSummary; file: OrderFile; customerName: string; key: string }
/** `error`: what to show for the failures (null when none). */
export interface DownloadResult { items: NewItem[]; done: string[]; failed: string[]; authFailed: boolean; error: string | null }

export const orderFileKey = (orderId: string, f: OrderFile) => `${orderId}:${f.itemId}`

/** Downloads each order file and builds a sheet item at native size (300 dpi, or a PDF's page size). Failures are reported, not thrown. */
export async function downloadOrderFiles(client: DtfClient, refs: OrderFileRef[]): Promise<DownloadResult> {
  const out: DownloadResult = { items: [], done: [], failed: [], authFailed: false, error: null }
  let noPdf = false
  const otherFailed: string[] = []
  const reasons: unknown[] = []
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
        ...nativeSizeMm(asset),
        quantity: 1,
      })
    } catch (e) {
      if (e instanceof AuthRequiredError) out.authFailed = true
      out.failed.push(`${o.orderNumber} ${f.sizeLabel}`)
      if (isPdfNotInstalled(e)) noPdf = true
      else {
        otherFailed.push(`${o.orderNumber} ${f.sizeLabel}`)
        reasons.push(e)
      }
    }
  }
  const errors = [noPdf && PDF_NOT_INSTALLED, otherFailed.length > 0 && downloadFailedText(otherFailed, reasons)].filter(Boolean)
  out.error = errors.length > 0 ? errors.join('. ') : null
  return out
}
