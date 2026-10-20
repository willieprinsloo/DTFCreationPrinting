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

/** Spinner at the drop point while a slow add (downloading the design) runs. */
function showDropBusy(p: Point, label: string, done: Promise<unknown>): void {
  const el = document.createElement('div')
  el.className = 'drop-busy'
  el.setAttribute('role', 'status')
  const spinner = document.createElement('span')
  spinner.className = 'spinner'
  el.append(spinner, `Adding ${label}…`)
  el.style.left = `${p.x + 12}px`
  el.style.top = `${p.y + 12}px`
  document.body.appendChild(el)
  const remove = () => el.remove()
  done.then(remove, remove)
}

/**
 * Starts tracking a drag. `action` runs only if the pointer is released over the canvas area;
 * if it returns a promise, a spinner shows at the drop point until it settles.
 */
export function beginLibraryDrag(
  e: { clientX: number; clientY: number; button: number },
  label: string,
  action: () => void | Promise<unknown>,
  /** Called on release with whether the press turned into a drag (so callers can swallow the click that follows). */
  onEnd?: (dragged: boolean) => void,
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
    onEnd?.(dragged)
    if (!dragged) return
    const canvas = document.querySelector('[data-testid="canvas-area"]')
    const p = { x: ev.clientX, y: ev.clientY }
    if (!canvas || !pointInRect(p, canvas.getBoundingClientRect())) return
    const result = action()
    if (result instanceof Promise) showDropBusy(p, label, result)
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cleanup()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', key)
}
