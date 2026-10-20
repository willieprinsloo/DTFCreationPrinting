export type ShortcutAction =
  | 'fit'
  | 'trueSize'
  | 'fitWidth'
  | 'zoomIn'
  | 'zoomOut'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'duplicate'
  | 'selectAll'
  | 'sizePrev'
  | 'sizeNext'

export interface ShortcutKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

const PLAIN: Record<string, ShortcutAction> = {
  '0': 'fit',
  '1': 'trueSize',
  '2': 'fitWidth',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  '[': 'sizePrev',
  ']': 'sizeNext',
  Delete: 'delete',
  Backspace: 'delete',
}

/** Maps a key event to a canvas action. Callers must skip events from text inputs. */
export function shortcutFor(e: ShortcutKeyEvent): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  if (mod) {
    switch (e.key.toLowerCase()) {
      case 'z':
        return e.shiftKey ? 'redo' : 'undo'
      case 'y':
        return e.ctrlKey ? 'redo' : null
      case 'd':
        return 'duplicate'
      case 'a':
        return 'selectAll'
      default:
        return null
    }
  }
  return PLAIN[e.key] ?? null
}
