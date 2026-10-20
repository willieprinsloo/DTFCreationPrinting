import { useSheet } from '../../state/sheetStore'
import { ItemProperties } from './ItemProperties'
import { SheetProperties } from './SheetProperties'

export function PropertiesPanel() {
  const selectedIds = useSheet((s) => s.selectedIds)
  return selectedIds.length === 0 ? <SheetProperties /> : <ItemProperties ids={selectedIds} />
}
