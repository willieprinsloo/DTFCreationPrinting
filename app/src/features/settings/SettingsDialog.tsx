import { useState } from 'react'
import type { PrinterProfile } from '../../domain/types'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { ScreenCalibration } from './ScreenCalibration'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Props {
  onClose(): void
}

function ProfileEditor({ profile, canRemove, onDone }: { profile: PrinterProfile; canRemove: boolean; onDone(): void }) {
  const [p, setP] = useState(profile)
  const [error, setError] = useState<string | null>(null)
  const num = (v: string) => Number(v)
  const setMargin = (k: keyof PrinterProfile['defaultMargins'], v: string) =>
    setP({ ...p, defaultMargins: { ...p.defaultMargins, [k]: num(v) } })

  const save = async () => {
    const m = p.defaultMargins
    if (!p.name.trim()) return setError('Give the printer a name')
    if (!(p.widthMm > 0)) return setError('Printer width must be more than 0 mm')
    if (!(p.xDpi > 0 && p.yDpi > 0)) return setError('Print resolution must be more than 0 dpi')
    if ([m.topMm, m.rightMm, m.bottomMm, m.leftMm, p.defaultGapMm].some((v) => !(v >= 0))) return setError('Margins and gap cannot be negative')
    if (p.widthMm - m.leftMm - m.rightMm <= 0) return setError('Margins leave no printable width')
    try {
      await getSettingsStore().getState().upsertProfile({ ...p, name: p.name.trim() })
      onDone()
    } catch (e) {
      setError(`Could not save: ${errorText(e)}`)
    }
  }

  const remove = async () => {
    try {
      await getSettingsStore().getState().removeProfile(p.id)
      onDone()
    } catch (e) {
      setError(`Could not remove: ${errorText(e)}`)
    }
  }

  const field = (label: string, value: number, onChange: (v: string) => void) => (
    <label className="dialog-field">
      {label}
      <input type="number" min={0} step="any" value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )

  return (
    <div className="profile-editor">
      <label className="dialog-field">
        Name
        <input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
      </label>
      <div className="field-grid">
        {field('Width (mm)', p.widthMm, (v) => setP({ ...p, widthMm: num(v) }))}
        {field('Across dpi', p.xDpi, (v) => setP({ ...p, xDpi: num(v) }))}
        {field('Along dpi', p.yDpi, (v) => setP({ ...p, yDpi: num(v) }))}
        {field('Gap (mm)', p.defaultGapMm, (v) => setP({ ...p, defaultGapMm: num(v) }))}
        {field('Top margin (mm)', p.defaultMargins.topMm, (v) => setMargin('topMm', v))}
        {field('Right margin (mm)', p.defaultMargins.rightMm, (v) => setMargin('rightMm', v))}
        {field('Bottom margin (mm)', p.defaultMargins.bottomMm, (v) => setMargin('bottomMm', v))}
        {field('Left margin (mm)', p.defaultMargins.leftMm, (v) => setMargin('leftMm', v))}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="primary" onClick={() => void save()}>
          Save printer
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        {canRemove && (
          <button type="button" className="danger" onClick={() => void remove()}>
            Remove printer
          </button>
        )}
      </div>
    </div>
  )
}

export function SettingsDialog({ onClose }: Props) {
  const apiBaseUrl = useSettings((s) => s.apiBaseUrl)
  const thresholds = useSettings((s) => s.thresholds)
  const profiles = useSettings((s) => s.profiles)

  const [url, setUrl] = useState(apiBaseUrl)
  const [fine, setFine] = useState(String(thresholds.fine))
  const [low, setLow] = useState(String(thresholds.low))
  const [editing, setEditing] = useState<PrinterProfile | null>(null)
  const [urlMsg, setUrlMsg] = useState<string | null>(null)
  const [dpiMsg, setDpiMsg] = useState<string | null>(null)

  const saveUrl = async () => {
    const trimmed = url.trim()
    try {
      new URL(trimmed)
    } catch {
      return setUrlMsg('Enter a full address, like https://dtfcreations.co.za/api/v1')
    }
    try {
      await getSettingsStore().getState().setApiBaseUrl(trimmed)
      setUrlMsg('Saved')
    } catch (e) {
      setUrlMsg(`Could not save: ${errorText(e)}`)
    }
  }

  const saveThresholds = async () => {
    const f = Number(fine)
    const l = Number(low)
    if (!(l > 0 && f > 0)) return setDpiMsg('Quality limits must be more than 0 dpi')
    try {
      await getSettingsStore().getState().setThresholds({ fine: f, low: l })
      setDpiMsg('Saved')
    } catch (e) {
      setDpiMsg(errorText(e))
    }
  }

  const newProfile = (): PrinterProfile => ({
    id: `printer-${Date.now().toString(36)}`,
    name: 'New printer',
    widthMm: 600,
    xDpi: 720,
    yDpi: 1800,
    defaultMargins: { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 },
    defaultGapMm: 3,
  })

  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>

        <section className="settings-section">
          <h3>DTF Creations address</h3>
          <label className="dialog-field">
            Server address
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void saveUrl()}>
              Save address
            </button>
            {urlMsg && <span role="status">{urlMsg}</span>}
          </div>
        </section>

        <section className="settings-section">
          <h3>Print quality limits</h3>
          <div className="field-grid">
            <label className="dialog-field">
              Fine from (dpi)
              <input type="number" value={fine} onChange={(e) => setFine(e.target.value)} />
            </label>
            <label className="dialog-field">
              Low from (dpi)
              <input type="number" value={low} onChange={(e) => setLow(e.target.value)} />
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveThresholds()}>
              Save limits
            </button>
            {dpiMsg && <span role="status">{dpiMsg}</span>}
          </div>
        </section>

        <section className="settings-section">
          <h3>Printers</h3>
          {editing ? (
            <ProfileEditor
              key={editing.id}
              profile={editing}
              canRemove={profiles.length > 1 && profiles.some((p) => p.id === editing.id)}
              onDone={() => setEditing(null)}
            />
          ) : (
            <>
              <ul className="profile-list">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.name} — {p.widthMm} mm, {p.xDpi} × {p.yDpi} dpi
                    </span>
                    <button type="button" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setEditing(newProfile())}>
                Add printer
              </button>
            </>
          )}
        </section>

        <ScreenCalibration />

        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
