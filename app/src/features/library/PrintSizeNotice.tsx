import { X } from 'lucide-react'
import { uiStore, useUi } from '../../state/uiStore'

/** Non-blocking note after a quick add that used the native width because no default was set. */
export function PrintSizeNotice() {
  const text = useUi((s) => s.printSizeNotice)
  if (!text) return null
  const ui = uiStore.getState()
  return (
    <div className="print-size-notice" role="status">
      <span>{text}</span>
      <button
        type="button"
        onClick={() => {
          ui.setPrintSizeNotice(null)
          ui.openSettings('print-sizes')
        }}
      >
        Open Print sizes
      </button>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => ui.setPrintSizeNotice(null)}>
        <X size={14} />
      </button>
    </div>
  )
}
