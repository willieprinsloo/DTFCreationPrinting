import { useCallback, useRef, useState } from 'react'
import { THEME_CHOICES, type FilmShade, type ThemeChoice } from '../../domain/theme'
import type { PrinterProfile } from '../../domain/types'
import { DEFAULT_ENGINE_SETTINGS } from '../../domain/engineSettings'
import { MIN_PREVIEW_LENGTH_FLOOR_MM, getSettingsStore, useSettings } from '../../state/settingsStore'
import type { SettingsTab } from '../../state/uiStore'
import { EngineSettings, type SavePending } from './EngineSettings'
import { PrintSizesPanel } from './PrintSizesPanel'
import { ScreenCalibration } from './ScreenCalibration'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Props {
  initialTab?: SettingsTab
  onClose(): void
}

const TABS: Array<[SettingsTab, string]> = [
  ['printers', 'Printers'],
  ['printer-ink', 'Ink & colour'],
  ['print-sizes', 'Print sizes'],
  ['general', 'General'],
]

function Help({ children }: { children: string }) {
  return <p className="field-help">{children}</p>
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
    if (!(p.widthMm > 0)) return setError('Film width must be more than 0 mm')
    if (!(p.xDpi > 0 && p.yDpi > 0)) return setError('Resolution must be more than 0 dpi')
    if ([m.topMm, m.rightMm, m.bottomMm, m.leftMm, p.defaultGapMm].some((v) => !(v >= 0))) return setError('Margins and spacing cannot be negative')
    if (p.widthMm - m.leftMm - m.rightMm <= 0) return setError('The left and right margins leave no room to print')
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
        Printer name
        <input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
      </label>

      <h4>Film and resolution</h4>
      <div className="field-grid">
        {field('Film width (mm)', p.widthMm, (v) => setP({ ...p, widthMm: num(v) }))}
        <span />
        {field('Resolution across the film (dpi)', p.xDpi, (v) => setP({ ...p, xDpi: num(v) }))}
        {field('Resolution along the film (dpi)', p.yDpi, (v) => setP({ ...p, yDpi: num(v) }))}
      </div>
      <Help>Use the same print mode as in Maintop or ATools, for example 720 × 1800 dpi.</Help>

      <h4>Starting layout for new sheets</h4>
      <div className="field-grid">
        {field('Top margin (mm)', p.defaultMargins.topMm, (v) => setMargin('topMm', v))}
        {field('Bottom margin (mm)', p.defaultMargins.bottomMm, (v) => setMargin('bottomMm', v))}
        {field('Left margin (mm)', p.defaultMargins.leftMm, (v) => setMargin('leftMm', v))}
        {field('Right margin (mm)', p.defaultMargins.rightMm, (v) => setMargin('rightMm', v))}
        {field('Space between designs (mm)', p.defaultGapMm, (v) => setP({ ...p, defaultGapMm: num(v) }))}
      </div>
      <Help>Margins keep designs away from the film edges. You can still change both on each sheet.</Help>

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

function PrintersPanel() {
  const profiles = useSettings((s) => s.profiles)
  const activeId = useSettings((s) => s.activeProfileId)
  const [editing, setEditing] = useState<PrinterProfile | null>(null)

  const newProfile = (): PrinterProfile => ({
    id: `printer-${Date.now().toString(36)}`,
    name: 'New printer',
    widthMm: 600,
    xDpi: 720,
    yDpi: 1800,
    defaultMargins: { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 },
    defaultGapMm: 3,
    ...DEFAULT_ENGINE_SETTINGS,
  })

  if (editing) {
    return (
      <section className="settings-section">
        <h3>{profiles.some((p) => p.id === editing.id) ? `Edit ${editing.name}` : 'Add a printer'}</h3>
        <ProfileEditor
          key={editing.id}
          profile={editing}
          canRemove={profiles.length > 1 && profiles.some((p) => p.id === editing.id)}
          onDone={() => setEditing(null)}
        />
      </section>
    )
  }

  return (
    <section className="settings-section">
      <h3>Printers</h3>
      <p className="muted">The film width, resolution and starting margins for each printer. Ink settings are on the Ink & colour tab.</p>
      <ul className="profile-list">
        {profiles.map((p) => (
          <li key={p.id} className="profile-card">
            <div>
              <strong>{p.name}</strong>
              {p.id === activeId && <span className="badge">In use</span>}
              <div className="muted">
                {p.widthMm / 10} cm film · {p.xDpi} × {p.yDpi} dpi · {p.defaultMargins.leftMm} mm margins
              </div>
            </div>
            <button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button type="button" onClick={() => setEditing(newProfile())}>
          Add printer
        </button>
      </div>
    </section>
  )
}

const THEME_LABELS: Record<ThemeChoice, string> = { system: 'Same as this computer', light: 'Light', dark: 'Dark' }

/** Applies as soon as it is picked (no Save needed). */
function Appearance() {
  const theme = useSettings((s) => s.theme)
  const filmShade = useSettings((s) => s.filmShade)
  const shades: Array<[FilmShade, string]> = [['light', 'White'], ['dark', 'Dark']]
  return (
    <section className="settings-section">
      <h3>Appearance</h3>
      <div className="seg" role="group" aria-label="Appearance">
        {THEME_CHOICES.map((t) => (
          <button key={t} type="button" aria-pressed={theme === t} onClick={() => void getSettingsStore().getState().setTheme(t)}>
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
      <h4>Film behind the designs</h4>
      <div className="seg" role="group" aria-label="Film behind the designs">
        {shades.map(([s, label]) => (
          <button key={s} type="button" aria-pressed={filmShade === s} onClick={() => void getSettingsStore().getState().setFilmShade(s)}>
            {label}
          </button>
        ))}
      </div>
      <Help>White shows colours as they look on a white garment. Dark makes white and pale designs easy to see. Also on the moon / sun button next to the zoom. Only changes the screen, not the print.</Help>
    </section>
  )
}

function GeneralPanel() {
  const apiBaseUrl = useSettings((s) => s.apiBaseUrl)
  const thresholds = useSettings((s) => s.thresholds)
  const minPreviewLengthMm = useSettings((s) => s.minPreviewLengthMm)
  const [url, setUrl] = useState(apiBaseUrl)
  const [fine, setFine] = useState(String(thresholds.fine))
  const [low, setLow] = useState(String(thresholds.low))
  const [previewCm, setPreviewCm] = useState(String(minPreviewLengthMm / 10))
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const fail = (text: string) => setMessage({ text, error: true })

  const save = async () => {
    const trimmed = url.trim()
    try {
      new URL(trimmed)
    } catch {
      return fail('Enter a full server address, like https://dtfcreations.co.za/api/v1')
    }
    const f = Number(fine)
    const l = Number(low)
    if (!(l > 0 && f > 0)) return fail('Quality warnings must be more than 0 dpi')
    if (l > f) return fail('"Too low below" must not be higher than "Good from"')
    const previewMm = Number(previewCm) * 10
    if (!(previewMm >= MIN_PREVIEW_LENGTH_FLOOR_MM)) return fail(`Empty sheet length must be at least ${MIN_PREVIEW_LENGTH_FLOOR_MM / 10} cm`)
    try {
      const s = getSettingsStore().getState()
      await s.setThresholds({ fine: f, low: l })
      await s.setMinPreviewLength(previewMm)
      await s.setApiBaseUrl(trimmed)
      setMessage({ text: 'Saved', error: false })
    } catch (e) {
      fail(`Could not save: ${errorText(e)}`)
    }
  }

  return (
    <>
      <Appearance />

      <section className="settings-section">
        <h3>Image quality warnings</h3>
        <p className="muted">
          Each design is checked against its printed size. Blue means good, amber means it may look soft, red means it will look blurry.
        </p>
        <div className="field-grid">
          <label className="dialog-field">
            Good from (dpi)
            <input type="number" min={1} value={fine} onChange={(e) => setFine(e.target.value)} />
          </label>
          <label className="dialog-field">
            Too low below (dpi)
            <input type="number" min={1} value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
        </div>
        <Help>Between the two numbers a design shows amber. 200 and 150 suit most DTF work.</Help>
      </section>

      <section className="settings-section">
        <h3>Canvas</h3>
        <label className="dialog-field">
          Empty sheet length (cm)
          <input type="number" min={MIN_PREVIEW_LENGTH_FLOOR_MM / 10} step="any" value={previewCm} onChange={(e) => setPreviewCm(e.target.value)} />
        </label>
        <Help>How much film a new sheet shows before you add designs. The sheet grows as you add more, up to 20 m.</Help>
      </section>

      <section className="settings-section">
        <h3>DTF Creations server</h3>
        <label className="dialog-field">
          Server address
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <Help>Only change this if DTF Creations asks you to.</Help>
      </section>

      <div className="button-row">
        <button type="button" className="primary" onClick={() => void save()}>
          Save
        </button>
        {message && (
          <span role={message.error ? 'alert' : 'status'} className={message.error ? 'inline-error' : undefined}>
            {message.text}
          </span>
        )}
      </div>

      <ScreenCalibration />
    </>
  )
}

export function SettingsDialog({ initialTab = 'printers', onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  /** Unsaved ink & colour changes are saved on the way out; a value that can't be saved keeps the page open. */
  const pending = useRef<SavePending | null>(null)
  const onPending = useCallback((save: SavePending | null) => {
    pending.current = save
  }, [])
  const leave = async (then: () => void) => {
    if (pending.current && !(await pending.current())) return
    then()
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-wide settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>
        <div className="settings-tabs" role="tablist" aria-label="Settings pages">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => void leave(() => setTab(id))}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'printers' && <PrintersPanel />}
        {tab === 'printer-ink' && <EngineSettings onPending={onPending} />}
        {tab === 'print-sizes' && <PrintSizesPanel />}
        {tab === 'general' && <GeneralPanel />}

        <div className="dialog-actions">
          <button type="button" className="primary" onClick={() => void leave(onClose)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
