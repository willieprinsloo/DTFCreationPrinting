import { ONE_SIZE, resolveWidthMm, widthKey } from '../../domain/printSizes'
import { getSettingsStore } from '../../state/settingsStore'
import { getSheetStore } from '../../state/sheetStore'
import { uiStore } from '../../state/uiStore'

/** Product type names by category id, remembered from loaded categories so keyboard stepping can name the type. */
const typeNames = new Map<string, string>()
export function rememberTypeNames(categories: Array<{ id: string; name: string }>): void {
  for (const c of categories) typeNames.set(c.id, c.name)
}

/**
 * Switches a placed product to another garment size: width from Settings › Print sizes (kept as is,
 * with a notice, when none is set; one-size-only types use their One size width). One undo step;
 * the item's centre stays put.
 */
export function changeItemSize(id: string, size: string | null, typeName = ''): void {
  const sheet = getSheetStore()
  const item = sheet.getState().sheet.items.find((i) => i.id === id)
  if (!item) return
  const categoryId = item.source.categoryId
  const { printSizes } = getSettingsStore().getState()
  const width = categoryId ? resolveWidthMm(printSizes, categoryId, size) : undefined
  sheet.getState().setItemSize(id, size, width ?? item.widthMm)
  const name = typeName || (categoryId ? typeNames.get(categoryId) : '') || 'this type'
  const key = categoryId ? widthKey(printSizes, categoryId, size) : size
  uiStore
    .getState()
    .setPrintSizeNotice(width === undefined ? `No default print size for ${name} · ${key ?? ONE_SIZE} — set it in Settings › Print sizes` : null)
}

/** Steps the selected product's size by `delta` within its offered sizes (no wrap). Without a size yet, ] picks the first and [ the last. */
export function stepItemSize(id: string, delta: 1 | -1): void {
  const item = getSheetStore().getState().sheet.items.find((i) => i.id === id)
  const sizes = item?.source.sizes
  if (!item || !item.source.productId || !sizes || sizes.length === 0) return
  if (item.source.size == null) {
    changeItemSize(id, delta === 1 ? sizes[0] : sizes[sizes.length - 1])
    return
  }
  const at = sizes.indexOf(item.source.size)
  const next = sizes[at + delta]
  if (at < 0 || next === undefined) return
  changeItemSize(id, next)
}
