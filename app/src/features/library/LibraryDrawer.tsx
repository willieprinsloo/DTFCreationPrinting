import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useSettings, getSettingsStore } from '../../state/settingsStore'
import { CatalogueTab } from './CatalogueTab'
import { GangSheetsTab } from './GangSheetsTab'
import { LocalTab } from './LocalTab'
import { useLocalFiles } from './useLocalFiles'

type Tab = 'catalogue' | 'gang' | 'local'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'gang', label: 'Gang sheets' },
  { id: 'local', label: 'Local' },
]

interface Props {
  collapsed: boolean
  onToggleCollapsed(): void
}

export function LibraryDrawer({ collapsed, onToggleCollapsed }: Props) {
  const [tab, setTab] = useState<Tab>('catalogue')
  const height = useSettings((s) => s.drawerHeightPx)
  const local = useLocalFiles()
  const drag = useRef<{ y: number; h: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    void getSettingsStore().getState().setDrawerHeight(drag.current.h + (drag.current.y - e.clientY)).catch(() => {})
  }
  const onPointerUp = () => {
    drag.current = null
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
          {tab === 'catalogue' && <CatalogueTab />}
          {tab === 'gang' && <GangSheetsTab />}
          {tab === 'local' && <LocalTab busy={local.busy} error={local.error} onPick={() => void local.pick()} />}
        </div>
      )}
    </div>
  )
}
