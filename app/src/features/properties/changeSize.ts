import { ONE_SIZE, defaultWidthMm } from '../../domain/printSizes'
import { getSettingsStore } from '../../state/settingsStore'
import { getSheetStore } from '../../state/sheetStore'
import { uiStore } from '../../state/uiStore'

/**
 * Switches a placed product to another garment size: width from Settings › Print sizes (kept as is,
 * with a notice, when none is set). One undo step; the item's centre stays put.
 */
export function changeItemSize(id: string, size: string | null, typeName = ''): void {
  const sheet = getSheetStore()
  const item = sheet.getState().sheet.items.find((i) => i.id === id)
  if (!item) return
  const categoryId = item.source.categoryId
  const width = categoryId ? defaultWidthMm(getSettingsStore().getState().printSizes.byType, categoryId, size) : undefined
  sheet.getState().setItemSize(id, size, width ?? item.widthMm)
  uiStore
    .getState()
    .setPrintSizeNotice(
      width === undefined ? `No default print size for ${typeName || 'this type'} · ${size ?? ONE_SIZE} — set it in Settings › Print sizes` : null,
    )
}

/** Steps the selected product's size by `delta` within its offered sizes (no wrap). */
export function stepItemSize(id: string, delta: 1 | -1): void {
  const item = getSheetStore().getState().sheet.items.find((i) => i.id === id)
  const sizes = item?.source.sizes
  if (!item || !item.source.productId || !sizes || sizes.length === 0) return
  const at = sizes.indexOf(item.source.size ?? '')
  const next = sizes[at + delta]
  if (at < 0 || next === undefined) return
  changeItemSize(id, next)
}
