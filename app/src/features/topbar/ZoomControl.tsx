import { useState } from 'react'
import { Minus, Moon, Plus, Sun } from 'lucide-react'
import { useViewport } from '../canvas/useViewport'
import { getSettingsStore, useSettings } from '../../state/settingsStore'

const STEP = 1.25

/** 100% means true physical size on screen. */
export function ZoomControl() {
  const { vp, fit, trueSize, zoomBy } = useViewport()
  const screenPxPerMm = useSettings((s) => s.screenPxPerMm)
  const percent = Math.round((vp.scale / screenPxPerMm) * 100)
  const [draft, setDraft] = useState<string | null>(null)
  const dark = useSettings((s) => s.filmShade) === 'dark'

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
        aria-label={dark ? 'Show the film white' : 'Show the film dark'}
        title={dark ? 'Show the film white' : 'Show the film dark (to see white and pale designs)'}
        aria-pressed={dark}
        onClick={() => void getSettingsStore().getState().setFilmShade(dark ? 'light' : 'dark')}
      >
        {dark ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  )
}
