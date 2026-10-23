import { useState } from 'react'
import { Minus, Moon, Plus, Sun } from 'lucide-react'
import { useViewport } from '../canvas/useViewport'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { useTheme } from '../../state/theme'

const STEP = 1.25

/** 100% means true physical size on screen. */
export function ZoomControl() {
  const { vp, fit, trueSize, zoomBy } = useViewport()
  const screenPxPerMm = useSettings((s) => s.screenPxPerMm)
  const percent = Math.round((vp.scale / screenPxPerMm) * 100)
  const [draft, setDraft] = useState<string | null>(null)
  const dark = useTheme() === 'dark'
  /** Switches the whole app light / dark; the film follows it again. */
  const toggleLook = () => {
    const s = getSettingsStore().getState()
    // Both change at once; saving them is best effort (the look still changes if it fails).
    void Promise.all([s.setTheme(dark ? 'light' : 'dark'), s.setFilmMode('auto')]).catch(() => {})
  }

  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace('%', ''))
    setDraft(null)
    if (Number.isFinite(n) && n > 0) zoomBy((n / 100) * screenPxPerMm / vp.scale)
  }

  return (
    <div className="zoom-control" role="group" aria-label="Zoom">
      <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / STEP)}>
        <Minus size={14} />
      </button>
      <input
        type="text"
        aria-label="Zoom percentage"
        value={draft ?? `${percent}%`}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setDraft(null)
        }}
      />
      <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(STEP)}>
        <Plus size={14} />
      </button>
      <button type="button" onClick={() => fit()}>Fit</button>
      <button type="button" onClick={() => trueSize()}>1:1</button>
      <button
        type="button"
        className="icon-btn"
        aria-label={dark ? 'Switch to the light look' : 'Switch to the dark look'}
        title={dark ? 'Switch to the light look' : 'Switch to the dark look (also makes white and pale designs easy to see)'}
        aria-pressed={dark}
        onClick={toggleLook}
      >
        {dark ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  )
}
