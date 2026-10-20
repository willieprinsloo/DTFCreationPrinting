import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react'
import { useSettings, getSettingsStore, clampDrawerHeight } from '../../state/settingsStore'
import { ProductsTab } from './ProductsTab'
import { CatalogueTab } from './CatalogueTab'
import { GangSheetsTab } from './GangSheetsTab'
import { LocalTab } from './LocalTab'
import { PrintSizeNotice } from './PrintSizeNotice'
import { useLocalFiles } from './useLocalFiles'
import { LibraryBrowser } from './browser/LibraryBrowser'
import { LIBRARY_TABS as TABS, type LibraryTab as Tab } from './tabs'

interface Props {
  collapsed: boolean
  onToggleCollapsed(): void
}

export function LibraryDrawer({ collapsed, onToggleCollapsed }: Props) {
  const [tab, setTab] = useState<Tab>('products')
  const [browserOpen, setBrowserOpen] = useState(false)
  const height = useSettings((s) => s.drawerHeightPx)
  const local = useLocalFiles()
  const drag = useRef<{ y: number; h: number; live: number; shell: HTMLElement | null } | null>(null)

  // ⌘/Ctrl+F pops the library out (also inside text fields: the app has no other find).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        if (document.querySelector('.dialog')) return
        e.preventDefault()
        setBrowserOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height, live: height, shell: e.currentTarget.closest<HTMLElement>('.app-shell') }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  // Live feedback sets the grid variable directly; the height is persisted once on release.
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.live = clampDrawerHeight(d.h + (d.y - e.clientY))
    d.shell?.style.setProperty('--drawer-h', `${d.live}px`)
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    getSettingsStore()
      .getState()
      .setDrawerHeight(d.live)
      .catch((err) => console.warn('Could not save library height', err))
  }

  return (
    <div className="library">
      {!collapsed && (
        <div
          className="drawer-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize library"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <div className="library-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id)
              if (collapsed) onToggleCollapsed()
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="pop-out-btn" title="Pop out library (⌘/Ctrl+F)" onClick={() => setBrowserOpen(true)}>
          <Maximize2 size={14} /> Pop out
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={collapsed ? 'Expand library' : 'Collapse library'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {!collapsed && (
        <div className="library-body" role="tabpanel">
          <PrintSizeNotice />
          {tab === 'products' && <ProductsTab />}
          {tab === 'catalogue' && <CatalogueTab />}
          {tab === 'gang' && <GangSheetsTab />}
          {tab === 'local' && <LocalTab busy={local.busy} error={local.error} onPick={() => void local.pick()} />}
        </div>
      )}
      {browserOpen && <LibraryBrowser tab={tab} onTabChange={setTab} onClose={() => setBrowserOpen(false)} local={local} />}
    </div>
  )
}
