import { useRef, useState } from 'react'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { DotGain, EngineSettings as Engine, InkChannel, PrinterProfile } from '../../domain/types'
import { MAINTOP_6PASS_PRESET, curveFromThree, curveToThree, isDetailedCurve, validateEngineSettings } from '../../domain/engineSettings'
import { createChartPrn } from '../../platform/tauri'
import { getSettingsStore, useSettings } from '../../state/settingsStore'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const INK_NAMES: Record<InkChannel, string> = { K: 'Black', C: 'Cyan', M: 'Magenta', Y: 'Yellow', W: 'White' }
const INKS = Object.keys(INK_NAMES) as InkChannel[]
const POINTS = [25, 50, 75]

const threeBoxes = (g: DotGain) =>
  Object.fromEntries(INKS.map((k) => [k, curveToThree(g[k]).map(String)])) as Record<InkChannel, string[]>
const detailedOnly = (g: DotGain): Partial<DotGain> =>
  Object.fromEntries(INKS.filter((k) => isDetailedCurve(g[k])).map((k) => [k, g[k]]))

function Help({ children }: { children: string }) {
  return <p className="field-help">{children}</p>
}

interface SliderProps {
  label: string
  left: string
  right: string
  min: number
  max: number
  value: number
  neutral: number
  describe(v: number): string
  onChange(v: number): void
}

/** A Maintop-style slider: plain words at each end and the current setting in words. */
function ToneSlider({ label, left, right, min, max, value, neutral, describe, onChange }: SliderProps) {
  return (
    <div className="tone-slider">
      <div className="tone-slider-head">
        <span>{label}</span>
        <span className={value === neutral ? 'muted' : 'tone-value'}>{describe(value)}</span>
      </div>
      <div className="tone-slider-track">
        <span className="muted">{left}</span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(neutral)}
        />
        <span className="muted">{right}</span>
      </div>
    </div>
  )
}

const describeDarkness = (v: number) => (v === 0 ? 'Normal' : v < 0 ? `${-v}% lighter` : `${v}% darker`)
const describeColour = (v: number) => (v === 100 ? 'Normal' : v < 100 ? `${100 - v}% less colour` : `${v - 100}% more colour`)

function Editor({ profile }: { profile: PrinterProfile }) {
  const [order, setOrder] = useState<InkChannel[]>(profile.channelOrder)
  const [ink, setInk] = useState(String(profile.inkLimitPct))
  const [density, setDensity] = useState(String(profile.whiteDensityPct))
  const [choke, setChoke] = useState(String(profile.whiteChokeMm))
  const [screening, setScreening] = useState(profile.screening)
  const [leadIn, setLeadIn] = useState(String(profile.leadInMm))
  const [icc, setIcc] = useState(profile.iccProfilePath)
  const [darkness, setDarkness] = useState(profile.darkness)
  const [saturation, setSaturation] = useState(profile.saturationPct)
  const [curves, setCurves] = useState<Record<InkChannel, string[]>>(() => threeBoxes(profile.dotGain))
  /** Curves with more detail than the three boxes, kept as they are until a box for that ink is edited. */
  const [detailed, setDetailed] = useState<Partial<DotGain>>(() => detailedOnly(profile.dotGain))
  const [presetMsg, setPresetMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [chartMsg, setChartMsg] = useState<string | null>(null)
  const [charting, setCharting] = useState(false)
  /** Set synchronously so a second click before the re-render cannot start another chart. */
  const chartBusy = useRef(false)
  const touch = () => {
    setSaved(false)
    setError(null)
  }

  /** The chosen ICC/ICM file, or null when the picker was cancelled or failed. */
  const pickIcc = async (): Promise<string | null> => {
    try {
      const f = await open({ multiple: false, filters: [{ name: 'Colour profile', extensions: ['icc', 'icm'] }] })
      if (typeof f === 'string') {
        setIcc(f)
        touch()
        return f
      }
    } catch (e) {
      setError(`Could not open the file picker: ${errorText(e)}`)
    }
    return null
  }

  /** The preset is only right with Maintop's profile, so nothing changes until that file is chosen. */
  const useMaintopPreset = async () => {
    setPresetMsg(null)
    if (!(await pickIcc())) return
    const p = MAINTOP_6PASS_PRESET
    setInk(String(p.inkLimitPct))
    setDensity(String(p.whiteDensityPct))
    setCurves(threeBoxes(p.dotGain))
    setDetailed(detailedOnly(p.dotGain))
    setPresetMsg(`Set ink limit ${p.inkLimitPct} %, white ${p.whiteDensityPct} % and Maintop's ink curves. Save to keep them.`)
  }

  /** The settings as typed, or the plain-English reason they can't be used. */
  const build = (): Engine | string => {
    const numbers = [ink, density, choke, leadIn, ...INKS.flatMap((k) => curves[k])]
    if (numbers.some((v) => v.trim() === '')) return 'Enter a number in every box'
    const dotGain = Object.fromEntries(
      INKS.map((k) => [k, detailed[k] ?? curveFromThree(curves[k].map(Number) as [number, number, number])]),
    ) as DotGain
    const engine: Engine = {
      channelOrder: order,
      inkLimitPct: Number(ink),
      whiteDensityPct: Number(density),
      whiteChokeMm: Number(choke),
      screening,
      dotGain,
      leadInMm: Number(leadIn),
      darkness,
      saturationPct: saturation,
      ...(icc ? { iccProfilePath: icc } : {}),
    }
    return validateEngineSettings(engine) ?? engine
  }

  const save = async () => {
    const engine = build()
    if (typeof engine === 'string') {
      setSaved(false)
      return setError(engine)
    }
    const { iccProfilePath: _old, ...rest } = profile
    try {
      await getSettingsStore().getState().upsertProfile({ ...rest, ...engine })
      setError(null)
      setSaved(true)
    } catch (e) {
      setError(`Could not save: ${errorText(e)}`)
    }
  }

  const makeChart = async (kind: 'colour' | 'white') => {
    if (chartBusy.current) return
    setError(null)
    setChartMsg(null)
    const engine = build()
    if (typeof engine === 'string') return setError(engine)
    chartBusy.current = true
    setCharting(true)
    try {
      const out = await saveDialog({ defaultPath: `${kind}-chart.prn`, filters: [{ name: 'PRN file', extensions: ['prn'] }] })
      if (!out) return
      setChartMsg(`Creating the ${kind} chart…`)
      const { iccProfilePath: _old, ...rest } = profile
      await createChartPrn(kind, { ...rest, ...engine }, out)
      setChartMsg(`Saved ${out}`)
    } catch (e) {
      setChartMsg(null)
      setError(`Could not create the chart: ${errorText(e)}`)
    } finally {
      chartBusy.current = false
      setCharting(false)
    }
  }


  const num = (label: string, value: string, set: (v: string) => void, help: string, step = 'any') => (
    <div>
      <label className="dialog-field">
        {label}
        <input type="number" step={step} value={value} onChange={(e) => { set(e.target.value); touch() }} />
      </label>
      <Help>{help}</Help>
    </div>
  )

  return (
    <>
      <section className="settings-section">
        <h3>Lighter or darker, more or less colour</h3>
        <Help>Adjusts every print from this printer. Make a colour chart PRN below to see the effect before you save. Double-click a slider to put it back to normal.</Help>
        <ToneSlider
          label="Lighter or darker"
          left="Lighter"
          right="Darker"
          min={-100}
          max={100}
          neutral={0}
          value={darkness}
          describe={describeDarkness}
          onChange={(v) => { setDarkness(v); touch() }}
        />
        <ToneSlider
          label="Colour"
          left="Less colour"
          right="More colour"
          min={50}
          max={150}
          neutral={100}
          value={saturation}
          describe={describeColour}
          onChange={(v) => { setSaturation(v); touch() }}
        />
        {(darkness !== 0 || saturation !== 100) && (
          <div className="button-row">
            <button type="button" className="link-btn" onClick={() => { setDarkness(0); setSaturation(100); touch() }}>
              Back to normal
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h3>Ink and white</h3>
        <div className="field-grid">
          {num('Ink limit (%)', ink, setInk, 'Most ink allowed on any spot, from 100 to 400. Lower it if dark areas look wet or crack.')}
          {num('White density (%)', density, setDensity, 'How solid the white under the design is, from 0 to 100. Lower white makes colours look duller on dark garments.')}
          {num('White choke (mm)', choke, setChoke, 'Pulls the white in from the edge of the design, from 0 to 2 mm. Raise it if you see a white halo around the colour.', '0.05')}
          {num('Blank film before first design (mm)', leadIn, setLeadIn, 'Empty film fed before printing starts, from 0 to 1000 mm. Usually 0.')}
          <div>
            <label className="dialog-field">
              Screening
              <select value={screening} onChange={(e) => { setScreening(e.target.value as Engine['screening']); touch() }}>
                <option value="blueNoise">Smooth (fast) — recommended</option>
                <option value="errorDiffusion">Fine detail (slower)</option>
              </select>
            </label>
            <Help>How the printer's dots are scattered to make shades. Try Fine detail if small text or thin lines look soft.</Help>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Colour profile</h3>
        <Help>Optional. Load the ICC file from Maintop or your ink supplier to match their colours. Without one, a built-in colour model is used.</Help>
        <p>{icc ?? 'No colour profile — the built-in colour model is used'}</p>
        <div className="button-row">
          <button type="button" onClick={() => void pickIcc()}>Choose colour profile…</button>
          {icc && (
            <button type="button" onClick={() => { setIcc(undefined); touch() }}>Remove colour profile</button>
          )}
        </div>
        <Help>For the 700DTF I3200 printer: choose Maintop's 720x1800_6paaas.icm (in the printer's Maintop driver folder) to print like Maintop at 720 x 1800, 6 pass. This also sets the ink limit, white and ink curves to match.</Help>
        <div className="button-row">
          <button type="button" onClick={() => void useMaintopPreset()}>Match Maintop 720×1800 6-pass…</button>
          {presetMsg && <span>{presetMsg}</span>}
        </div>
      </section>

      <section className="settings-section">
        <h3>Test charts</h3>
        <Help>Creates a chart PRN with the settings on this page (even before you save them). Print it, change a setting, and print it again to compare.</Help>
        <div className="button-row">
          <button type="button" disabled={charting} onClick={() => void makeChart('colour')}>Create colour chart PRN</button>
          <button type="button" disabled={charting} onClick={() => void makeChart('white')}>Create white chart PRN</button>
          {chartMsg && <span>{chartMsg}</span>}
        </div>
      </section>

      <details className="settings-advanced">
        <summary>Advanced: ink channels and curves</summary>
        <p className="muted">Set these once when setting up a printer. Most people never need to change them.</p>

        <section className="settings-section">
          <h3>Ink channels</h3>
          <Help>Which ink the printer expects on each of its six channels, numbered as on the channel test print. Use black, cyan, magenta and yellow once each and white twice.</Help>
          <div className="field-grid">
            {order.map((c, i) => (
              <label key={i} className="dialog-field">
                {`Channel ${i} ink`}
                <select value={c} onChange={(e) => { setOrder(order.map((o, j) => (j === i ? (e.target.value as InkChannel) : o))); touch() }}>
                  {INKS.map((k) => (
                    <option key={k} value={k}>{INK_NAMES[k]}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Ink curves</h3>
          <Help>How strongly each ink prints at 25, 50 and 75 % (0 to 100). Leave them at 25, 50, 75 for no change. Raise a value to print that ink darker at that level.</Help>
          {INKS.some((k) => detailed[k]) && (
            <Help>{`${INKS.filter((k) => detailed[k]).map((k) => INK_NAMES[k]).join(', ')}: detailed curve (from a preset). Changing a box for that ink replaces it with just these three points.`}</Help>
          )}
          <div className="curve-grid">
            <span />
            {POINTS.map((p) => <span key={p} className="curve-head">{p} %</span>)}
            {INKS.map((k) => [
              <span key={k} className="curve-ink">{INK_NAMES[k]}</span>,
              ...POINTS.map((p, i) => (
                <input
                  key={`${k}${p}`}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  aria-label={`${INK_NAMES[k]} curve at ${p} %`}
                  value={curves[k][i]}
                  onChange={(e) => {
                    setCurves({ ...curves, [k]: curves[k].map((v, j) => (j === i ? e.target.value : v)) })
                    setDetailed(({ [k]: _dropped, ...rest }) => rest)
                    touch()
                  }}
                />
              )),
            ])}
          </div>
        </section>
      </details>

      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="button" className="primary" onClick={() => void save()}>Save ink & colour settings</button>
        {saved && <span role="status">Saved</span>}
      </div>
    </>
  )
}

export function EngineSettings() {
  const profiles = useSettings((s) => s.profiles)
  const activeId = useSettings((s) => s.activeProfileId)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const profile = profiles.find((p) => p.id === (pickedId ?? activeId)) ?? profiles[0]
  return (
    <>
      {profiles.length > 1 && (
        <label className="dialog-field">
          Settings for printer
          <select value={profile.id} onChange={(e) => setPickedId(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <Editor key={profile.id} profile={profile} />
    </>
  )
}
