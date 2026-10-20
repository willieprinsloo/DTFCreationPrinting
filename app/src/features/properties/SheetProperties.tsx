import { useState } from 'react'
import { Link, Unlink } from 'lucide-react'
import { useSheet } from '../../state/sheetStore'
import { getSheetStore } from '../../state/sheetStore'
import { InvalidSheetError } from '../../domain/geometry'
import type { Margins, SheetSettings } from '../../domain/types'
import { NumberField } from './NumberField'

const PRESET_WIDTHS = [300, 600]
const NO_PRINTABLE_WIDTH = 'Margins leave no printable width'

export function SheetProperties() {
  const settings = useSheet((s) => s.sheet.settings)
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = (patch: Partial<SheetSettings>, invalid = false, message = '') => {
    if (invalid) {
      setError(message)
      return
    }
    try {
      getSheetStore().getState().setSettings(patch)
      setError(null)
    } catch (e) {
      if (e instanceof InvalidSheetError) setError(NO_PRINTABLE_WIDTH)
      else throw e
    }
  }

  const setWidth = (widthMm: number) =>
    apply({ widthMm }, !(widthMm > 0), 'Printer width must be more than 0 mm')

  const setMargin = (key: keyof Margins, v: number) => {
    const margins: Margins = linked
      ? { topMm: v, rightMm: v, bottomMm: v, leftMm: v }
      : { ...settings.margins, [key]: v }
    apply({ margins }, !(v >= 0), 'Margins cannot be negative')
  }

  const m = settings.margins
  return (
    <div className="props-section" data-testid="sheet-properties">
      <h2>Sheet</h2>

      <div className="props-group">
        <NumberField label="Printer width" unit="mm" decimals={0} value={settings.widthMm} onCommit={setWidth} />
        <div className="chips">
          {PRESET_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className="chip"
              aria-pressed={settings.widthMm === w}
              onClick={() => setWidth(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="props-group">
        <div className="props-row-head">
          <h3>Margins</h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="Link margins"
            aria-pressed={linked}
            title={linked ? 'Margins are linked' : 'Link margins'}
            onClick={() => setLinked(!linked)}
          >
            {linked ? <Link size={14} /> : <Unlink size={14} />}
          </button>
        </div>
        <div className="grid-2">
          <NumberField label="Top margin" unit="mm" value={m.topMm} onCommit={(v) => setMargin('topMm', v)} />
          <NumberField label="Right margin" unit="mm" value={m.rightMm} onCommit={(v) => setMargin('rightMm', v)} />
          <NumberField label="Bottom margin" unit="mm" value={m.bottomMm} onCommit={(v) => setMargin('bottomMm', v)} />
          <NumberField label="Left margin" unit="mm" value={m.leftMm} onCommit={(v) => setMargin('leftMm', v)} />
        </div>
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="props-group">
        <NumberField
          label="Gap between designs"
          unit="mm"
          value={settings.gapMm}
          onCommit={(gapMm) => apply({ gapMm }, !(gapMm >= 0), 'Gap cannot be negative')}
        />
      </div>

      <div className="props-group">
        <div className="segmented" role="group" aria-label="Film length">
          {(['auto', 'fixed'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={settings.lengthMode === mode}
              onClick={() => apply({ lengthMode: mode })}
            >
              {mode === 'auto' ? 'Auto length' : 'Fixed length'}
            </button>
          ))}
        </div>
        {settings.lengthMode === 'fixed' && (
          <NumberField
            label="Film length"
            unit="mm"
            decimals={0}
            value={settings.fixedLengthMm}
            onCommit={(fixedLengthMm) => apply({ fixedLengthMm }, !(fixedLengthMm > 0), 'Film length must be more than 0 mm')}
          />
        )}
      </div>

      <div className="props-group toggles">
        <label>
          <input type="checkbox" checked={settings.mirror} onChange={(e) => apply({ mirror: e.target.checked })} />
          Mirror for printing
        </label>
        <label>
          <input type="checkbox" checked={settings.allowRotate} onChange={(e) => apply({ allowRotate: e.target.checked })} />
          Allow rotating in auto-place
        </label>
      </div>
    </div>
  )
}
