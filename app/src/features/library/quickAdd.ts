import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { ProductSummary } from '../../api/types'
import type { SourceRef } from '../../domain/types'
import { printableArea } from '../../domain/geometry'
import { ONE_SIZE, defaultWidthMm, pickSize } from '../../domain/printSizes'
import { cacheAsset } from '../../platform/tauri'
import { getSettingsStore } from '../../state/settingsStore'
import { getSheetStore, type NewItem } from '../../state/sheetStore'
import { uiStore } from '../../state/uiStore'
import { useProductSources } from './queries/useProductSources'

const NATIVE_DPI = 300

export interface QuickAddResult {
  added: number
  /** Products skipped (no design file / download failed), in plain English; null when all went in. */
  error: string | null
}

/**
 * One-click add: 1 × the default garment size per product, at the width from Settings › Print sizes
 * (or the design's native width at 300 dpi, capped to the printable width, when none is set — with
 * a notice pointing at the setting). All products go in as one undo step.
 */
export function useQuickAdd(typeName: (categoryId: string) => string) {
  const { client, requireLogin } = useDtfClient()
  const sources = useProductSources()

  return async (products: ProductSummary[]): Promise<QuickAddResult> => {
    const { printSizes } = getSettingsStore().getState()
    let maxWidthMm = Infinity
    try {
      maxWidthMm = printableArea(getSheetStore().getState().sheet.settings).widthMm
    } catch {
      // No printable width: leave the native width uncapped.
    }
    const items: NewItem[] = []
    const unset = new Set<string>()
    const noDesign: string[] = []
    const failed: string[] = []

    for (const p of products) {
      try {
        const src = await sources.get(p.id)
        if (!src.designUrl) {
          noDesign.push(p.name)
          continue
        }
        const url = client.absoluteUrl(src.designUrl)
        const asset = await cacheAsset(url, client.bearerFor(url))
        const size = pickSize(src.sizes, printSizes.defaultSize)
        const tableWidth = defaultWidthMm(printSizes.byType, p.categoryId, size)
        if (tableWidth === undefined) unset.add(`${typeName(p.categoryId) || 'this type'} · ${size ?? ONE_SIZE}`)
        const widthMm = tableWidth ?? Math.min((asset.widthPx / NATIVE_DPI) * 25.4, maxWidthMm)
        const source: SourceRef = {
          kind: 'gallery',
          id: p.id,
          productId: p.id,
          categoryId: p.categoryId,
          size,
          sizes: src.sizes,
          label: size ? `${p.name} — ${size}` : p.name,
        }
        items.push({ asset, source, widthMm, heightMm: (widthMm * asset.heightPx) / asset.widthPx, quantity: 1 })
      } catch (e) {
        if (e instanceof AuthRequiredError) requireLogin()
        failed.push(p.name)
      }
    }

    if (items.length > 0) getSheetStore().getState().addItems(items)
    uiStore
      .getState()
      .setPrintSizeNotice(unset.size > 0 ? `No default print size for ${[...unset].join(', ')} — set it in Settings › Print sizes` : null)
    const errors = [
      noDesign.length > 0 && `No design file for ${noDesign.join(', ')}`,
      failed.length > 0 && `Couldn't download ${failed.map((n) => `"${n}"`).join(', ')} — try again`,
    ].filter((x): x is string => !!x)
    return { added: items.length, error: errors.length > 0 ? errors.join('. ') : null }
  }
}
