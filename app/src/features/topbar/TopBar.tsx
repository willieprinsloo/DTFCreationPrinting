import { useState } from 'react'
import { FileOutput, LayoutGrid, Redo2, Settings, Undo2 } from 'lucide-react'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { InvalidSheetError } from '../../domain/geometry'
import { ZoomControl } from './ZoomControl'
import { newSheetFile, openSheet, openSheetAt, saveSheet, saveSheetAs } from '../sheets/sheetFiles'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Props {
  onCreatePrn?(): void
  onOpenSettings?(): void
}

export function TopBar({ onCreatePrn = () => {}, onOpenSettings = () => {} }: Props) {
  const name = useSheet((s) => s.sheet.name)
  const profiles = useSettings((s) => s.profiles)
  const profileId = useSheet((s) => s.sheet.profileId)
  const recent = useSettings((s) => s.recentSheets)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const fileAction = (fn: () => Promise<void> | void) => async () => {
    setMenuOpen(false)
    try {
      await fn()
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const rename = (value: string) => {
    const trimmed = value.trim()
    const { sheet } = getSheetStore().getState()
    if (trimmed && trimmed !== sheet.name) getSheetStore().setState({ sheet: { ...sheet, name: trimmed } })
  }

  const chooseProfile = async (id: string) => {
    const profile = profiles.find((p) => p.id === id)
    if (!profile) return
    try {
      getSheetStore().getState().applyProfile(profile)
    } catch (e) {
      setError(e instanceof InvalidSheetError ? 'Margins leave no printable width' : errorText(e))
      return
    }
    try {
      await getSettingsStore().getState().setActiveProfile(id)
      setError(null)
    } catch (e) {
      setError(`Could not save the printer choice: ${errorText(e)}`)
    }
  }

  return (
    <div className="topbar-inner">
      <div className="file-menu">
        <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          File
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={fileAction(newSheetFile)}>New</button>
            <button type="button" role="menuitem" onClick={fileAction(openSheet)}>Open…</button>
            <button type="button" role="menuitem" onClick={fileAction(saveSheet)}>Save</button>
            <button type="button" role="menuitem" onClick={fileAction(saveSheetAs)}>Save as…</button>
            <div className="menu-label">Recent</div>
            {recent.length === 0 && <div className="menu-label muted">No recent sheets</div>}
            {recent.map((path) => (
              <button key={path} type="button" role="menuitem" title={path} onClick={fileAction(() => openSheetAt(path))}>
                {path.split(/[\\/]/).pop()}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        key={name}
        className="sheet-name"
        aria-label="Sheet name"
        defaultValue={name}
        onBlur={(e) => rename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <select aria-label="Printer profile" value={profileId} onChange={(e) => void chooseProfile(e.target.value)}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
      <button type="button" onClick={() => getSheetStore().getState().autoPlaceAll()}>
        <LayoutGrid size={14} /> Auto-place
      </button>
      <button type="button" className="icon-btn" aria-label="Undo" title="Undo" onClick={() => getSheetStore().getState().undo()}>
        <Undo2 size={14} />
      </button>
      <button type="button" className="icon-btn" aria-label="Redo" title="Redo" onClick={() => getSheetStore().getState().redo()}>
        <Redo2 size={14} />
      </button>
      <ZoomControl />
      <span className="spacer" />
      <button type="button" className="primary" onClick={onCreatePrn}>
        <FileOutput size={14} /> Create PRN
      </button>
      <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
        <Settings size={14} />
      </button>
    </div>
  )
}
