import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { DotGain, EngineSettings as Engine, InkChannel, PrinterProfile } from '../../domain/types'
import { curveFromThree, curveToThree, validateEngineSettings } from '../../domain/engineSettings'
import { getSettingsStore, useSettings } from '../../state/settingsStore'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const INK_NAMES: Record<InkChannel, string> = { K: 'Black', C: 'Cyan', M: 'Magenta', Y: 'Yellow', W: 'White' }
const INKS = Object.keys(INK_NAMES) as InkChannel[]
const POINTS = [25, 50, 75]

function Help({ children }: { children: string }) {
  return <p className="field-help">{children}</p>
}

function Editor({ profile }: { profile: PrinterProfile }) {
  const [order, setOrder] = useState<InkChannel[]>(profile.channelOrder)
  const [ink, setInk] = useState(String(profile.inkLimitPct))
  const [density, setDensity] = useState(String(profile.whiteDensityPct))
  const [choke, setChoke] = useState(String(profile.whiteChokeMm))
  const [screening, setScreening] = useState(profile.screening)
  const [leadIn, setLeadIn] = useState(String(profile.leadInMm))
  const [icc, setIcc] = useState(profile.iccProfilePath)
  const [curves, setCurves] = useState<Record<InkChannel, string[]>>(
    () => Object.fromEntries(INKS.map((k) => [k, curveToThree(profile.dotGain[k]).map(String)])) as Record<InkChannel, string[]>,
  )
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const touch = () => {
    setSaved(false)
    setError(null)
  }

  const pickIcc = async () => {
    try {
      const f = await open({ multiple: false, filters: [{ name: 'Colour profile', extensions: ['icc', 'icm'] }] })
      if (typeof f === 'string') {
        setIcc(f)
        touch()
      }
    } catch (e) {
      setError(`Could not open the file picker: ${errorText(e)}`)
    }
  }

  const save = async () => {
    const dotGain = Object.fromEntries(
      INKS.map((k) => [k, curveFromThree(curves[k].map(Number) as [number, number, number])]),
    ) as DotGain
    const engine: Engine = {
      channelOrder: order,
      inkLimitPct: Number(ink),
      whiteDensityPct: Number(density),
      whiteChokeMm: Number(choke),
      screening,
      dotGain,
      leadInMm: Number(leadIn),
      ...(icc ? { iccProfilePath: icc } : {}),
    }
    const problem = validateEngineSettings(engine)
    if (problem) {
      setSaved(false)
      return setError(problem)
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
        <h3>Ink channels</h3>
        <Help>Which ink the printer expects on each of its six channels. Use black, cyan, magenta and yellow once each and white twice. Check this with the channel test print.</Help>
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
        <h3>Ink and white</h3>
        <div className="field-grid">
          {num('Ink limit (%)', ink, setInk, 'Most ink allowed on any spot, from 100 to 400. Lower it if dark areas look wet or crack.')}
          {num('White density (%)', density, setDensity, 'How solid the white under the design is, from 0 to 100. Lower it for a softer feel.')}
          {num('White choke (mm)', choke, setChoke, 'Pulls the white in from the edge of the design, from 0 to 2 mm. Raise it if you see a white halo around the colour.', '0.05')}
          {num('Lead-in (mm)', leadIn, setLeadIn, 'Blank film added before the first design, from 0 to 1000 mm.')}
          <div>
            <label className="dialog-field">
              Screening
              <select value={screening} onChange={(e) => { setScreening(e.target.value as Engine['screening']); touch() }}>
                <option value="blueNoise">Blue noise (smooth, default)</option>
                <option value="errorDiffusion">Error diffusion (sharper detail)</option>
              </select>
            </label>
            <Help>How the printer's dots are scattered to make shades. Try the other one if you see patterns.</Help>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Colour profile</h3>
        <Help>Optional. Load the ICC file from Maintop to match its colours. Without one, a built-in colour model is used.</Help>
        <p>{icc ?? 'No colour profile — the built-in colour model is used'}</p>
        <div className="button-row">
          <button type="button" onClick={() => void pickIcc()}>Choose colour profile…</button>
          {icc && (
            <button type="button" onClick={() => { setIcc(undefined); touch() }}>Remove colour profile</button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>Ink curves</h3>
        <Help>How strongly each ink prints at 25, 50 and 75 % (0 to 100). Straight-through is 25, 50, 75. Raise a value to print that ink darker at that level.</Help>
        <div className="field-grid">
          {INKS.map((k) =>
            POINTS.map((p, i) => (
              <label key={`${k}${p}`} className="dialog-field">
                {`${k} curve at ${p} %`}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={curves[k][i]}
                  onChange={(e) => { setCurves({ ...curves, [k]: curves[k].map((v, j) => (j === i ? e.target.value : v)) }); touch() }}
                />
              </label>
            )),
          )}
        </div>
      </section>

      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="button" className="primary" onClick={() => void save()}>Save printer & ink settings</button>
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
          Printer
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
