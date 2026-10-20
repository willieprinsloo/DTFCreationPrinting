/**
 * Pointer-based drag from a library thumbnail onto the canvas area. HTML5 drag-and-drop is
 * unavailable in WebView2 when Tauri's dragDropEnabled is on (needed for OS file drops).
 */
const THRESHOLD_PX = 5

export interface Point { x: number; y: number }
export interface BoxLike { left: number; top: number; right: number; bottom: number }

export function pointInRect(p: Point, r: BoxLike): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
}

export function movedPastThreshold(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= THRESHOLD_PX
}

/** Starts tracking a drag. `action` runs only if the pointer is released over the canvas area. */
export function beginLibraryDrag(
  e: { clientX: number; clientY: number; button: number },
  label: string,
  action: () => void,
): void {
  if (e.button !== 0) return
  const start = { x: e.clientX, y: e.clientY }
  let ghost: HTMLDivElement | null = null

  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', key)
    ghost?.remove()
    ghost = null
  }
  const move = (ev: PointerEvent) => {
    const p = { x: ev.clientX, y: ev.clientY }
    if (!ghost) {
      if (!movedPastThreshold(start, p)) return
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = label
      document.body.appendChild(ghost)
    }
    ghost.style.left = `${p.x + 12}px`
    ghost.style.top = `${p.y + 12}px`
  }
  const up = (ev: PointerEvent) => {
    const dragged = ghost !== null
    cleanup()
    if (!dragged) return
    const canvas = document.querySelector('[data-testid="canvas-area"]')
    if (canvas && pointInRect({ x: ev.clientX, y: ev.clientY }, canvas.getBoundingClientRect())) action()
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cleanup()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', key)
}
