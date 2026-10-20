import { FileOutput, LayoutGrid, Redo2, Settings, Undo2 } from 'lucide-react'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { InvalidSheetError } from '../../domain/geometry'
import { ZoomControl } from './ZoomControl'

interface Props {
  onCreatePrn?(): void
  onOpenSettings?(): void
}

export function TopBar({ onCreatePrn = () => {}, onOpenSettings = () => {} }: Props) {
  const name = useSheet((s) => s.sheet.name)
  const profiles = useSettings((s) => s.profiles)
  const activeProfileId = useSettings((s) => s.activeProfileId)

  const rename = (value: string) => {
    const trimmed = value.trim()
    const { sheet } = getSheetStore().getState()
    if (trimmed && trimmed !== sheet.name) getSheetStore().setState({ sheet: { ...sheet, name: trimmed } })
  }

  const chooseProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id)
    if (!profile) return
    void getSettingsStore().getState().setActiveProfile(id).catch(() => {})
    try {
      getSheetStore().getState().setSettings({
        widthMm: profile.widthMm,
        margins: { ...profile.defaultMargins },
        gapMm: profile.defaultGapMm,
      })
    } catch (e) {
      if (!(e instanceof InvalidSheetError)) throw e
    }
  }

  return (
    <div className="topbar-inner">
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
      <select aria-label="Printer profile" value={activeProfileId} onChange={(e) => chooseProfile(e.target.value)}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
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
