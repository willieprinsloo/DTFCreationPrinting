import { useEffect, useRef, useState } from 'react'
import { getSheetStore } from '../../../state/sheetStore'

/**
 * Runs one add-dialog per item, in order. When the queue empties, `onAdded` fires if the sheet
 * gained items (so cancelling every dialog leaves the browser open).
 */
export function useDialogQueue<T>(onAdded: () => void) {
  const [queue, setQueue] = useState<T[]>([])
  const before = useRef<number | null>(null)
  const onAddedRef = useRef(onAdded)
  onAddedRef.current = onAdded

  useEffect(() => {
    if (queue.length > 0 || before.current === null) return
    const added = getSheetStore().getState().sheet.items.length > before.current
    before.current = null
    if (added) onAddedRef.current()
  }, [queue.length])

  const start = (items: T[]) => {
    if (items.length === 0) return
    before.current = getSheetStore().getState().sheet.items.length
    setQueue(items)
  }
  const next = () => setQueue((q) => q.slice(1))
  return { current: queue[0] as T | undefined, start, next }
}
