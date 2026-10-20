/** HTML5 drag from a library thumbnail onto the canvas area. The payload is a callback, not data. */
export const LIBRARY_DRAG_MIME = 'application/x-dtf-library-item'

let pending: (() => void) | null = null

export function beginLibraryDrag(e: { dataTransfer: DataTransfer | null }, action: () => void): void {
  pending = action
  if (e.dataTransfer) {
    e.dataTransfer.setData(LIBRARY_DRAG_MIME, '1')
    e.dataTransfer.effectAllowed = 'copy'
  }
}

export function endLibraryDrag(): void {
  pending = null
}

export function isLibraryDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(LIBRARY_DRAG_MIME)
}

/** Runs the action of the drag in progress (same as pressing Add). */
export function dropLibraryDrag(): void {
  const a = pending
  pending = null
  a?.()
}
