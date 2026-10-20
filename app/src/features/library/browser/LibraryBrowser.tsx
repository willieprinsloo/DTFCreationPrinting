import { useRef } from 'react'
import { X } from 'lucide-react'
import { getViewportStore } from '../../canvas/useViewport'
import { LocalTab } from '../LocalTab'
import { LIBRARY_TABS, type LibraryTab } from '../tabs'
import { DesignsPanel } from './DesignsPanel'
import { OrdersPanel } from './OrdersPanel'
import { ProductsPanel } from './ProductsPanel'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  tab: LibraryTab
  onTabChange(t: LibraryTab): void
  onClose(): void
  local: { busy: boolean; error: string | null; pick(): Promise<number> }
}

/** Large in-window library panel: search, filter, page and multi-select, then add to the sheet. */
export function LibraryBrowser({ tab, onTabChange, onClose, local }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)

  const onAdded = () => {
    onClose()
    getViewportStore().getState().fit()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Canvas shortcuts (Delete, ⌘A, 0…) must not act on the sheet while the browser is open.
    e.stopPropagation()
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.dialog')) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="lib-browser-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="lib-browser" role="dialog" aria-modal="true" aria-label="Library browser" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="lib-browser-header">
          <div role="tablist" aria-label="Library sources" className="lib-browser-tabs">
            {LIBRARY_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTabChange(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" aria-label="Close library browser" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {tab === 'products' && <ProductsPanel onAdded={onAdded} />}
        {tab === 'catalogue' && <DesignsPanel onAdded={onAdded} />}
        {tab === 'gang' && <OrdersPanel onAdded={onAdded} />}
        {tab === 'local' && (
          <LocalTab
            busy={local.busy}
            error={local.error}
            onPick={() => void local.pick().then((n) => n > 0 && onAdded())}
          />
        )}
      </div>
    </div>
  )
}
