import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { ProductSummary } from '../../api/types'
import type { SourceRef } from '../../domain/types'
import { assetAspect, nativeSizeMm } from '../../domain/dpi'
import { printableArea } from '../../domain/geometry'
import { ONE_SIZE, pickSize, resolveWidthMm, widthKey } from '../../domain/printSizes'
import { cacheAsset } from '../../platform/tauri'
import { getSettingsStore } from '../../state/settingsStore'
import { getSheetStore, type NewItem } from '../../state/sheetStore'
import { uiStore } from '../../state/uiStore'
import { useProductSources } from './queries/useProductSources'

export interface QuickAddResult {
  /** Ids of the products that went onto the sheet. */
  addedIds: string[]
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
    const addedIds: string[] = []
    let authFailed = false
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
        // A one-size-only type is printed at its One size width, but the item keeps its real garment size.
        const tableWidth = resolveWidthMm(printSizes, p.categoryId, size)
        if (tableWidth === undefined) unset.add(`${typeName(p.categoryId) || 'this type'} · ${widthKey(printSizes, p.categoryId, size) ?? ONE_SIZE}`)
        const widthMm = tableWidth ?? Math.min(nativeSizeMm(asset).widthMm, maxWidthMm)
        const source: SourceRef = {
          kind: 'gallery',
          id: p.id,
          productId: p.id,
          categoryId: p.categoryId,
          size,
          sizes: src.sizes,
          label: size ? `${p.name} — ${size}` : p.name,
        }
        items.push({ asset, source, widthMm, heightMm: widthMm * assetAspect(asset), quantity: 1 })
        addedIds.push(p.id)
      } catch (e) {
        if (e instanceof AuthRequiredError) authFailed = true
        failed.push(p.name)
      }
    }
    if (authFailed) requireLogin()

    if (items.length > 0) getSheetStore().getState().addItems(items)
    uiStore
      .getState()
      .setPrintSizeNotice(unset.size > 0 ? `No default print size for ${[...unset].join(', ')} — set it in Settings › Print sizes` : null)
    const errors = [
      noDesign.length > 0 && `No design file for ${noDesign.join(', ')}`,
      failed.length > 0 && `Couldn't download ${failed.map((n) => `"${n}"`).join(', ')} — try again`,
    ].filter((x): x is string => !!x)
    return { addedIds, error: errors.length > 0 ? errors.join('. ') : null }
  }
}
