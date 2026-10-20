import { useState } from 'react'
import { Copy, Lock, LockOpen, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { useSettings } from '../../state/settingsStore'
import { dpiStatus, effectiveDpi } from '../../domain/dpi'
import { NumberField } from './NumberField'

const LABELS = { fine: 'Good', low: 'Low', bad: 'Too low' } as const
const MM_PER_CM = 10

const norm = (deg: number) => ((deg % 360) + 360) % 360

export function ItemProperties({ ids }: { ids: string[] }) {
  const item = useSheet((s) => (ids.length === 1 ? s.sheet.items.find((i) => i.id === ids[0]) : undefined))
  const thresholds = useSettings((s) => s.thresholds)
  const [lockAspect, setLockAspect] = useState(true)
  const actions = getSheetStore().getState()

  const buttons = (
    <div className="button-row">
      <button type="button" onClick={() => getSheetStore().getState().duplicateItems(ids)}>
        <Copy size={14} /> Duplicate
      </button>
      <button type="button" className="danger" onClick={() => getSheetStore().getState().removeItems(ids)}>
        <Trash2 size={14} /> Delete
      </button>
    </div>
  )

  if (ids.length !== 1 || !item) {
    return (
      <div className="props-section" data-testid="item-properties">
        <h2>{ids.length} designs selected</h2>
        {buttons}
      </div>
    )
  }

  const dpi = effectiveDpi(item)
  const status = dpiStatus(dpi, thresholds)
  const setWidth = (cm: number) => {
    if (!(cm > 0)) return
    const mm = cm * MM_PER_CM
    if (lockAspect) actions.resizeItem(item.id, mm, true)
    else actions.updateItem(item.id, { widthMm: mm })
  }
  const setHeight = (cm: number) => {
    if (!(cm > 0)) return
    const mm = cm * MM_PER_CM
    if (lockAspect) actions.resizeItem(item.id, (mm * item.widthMm) / item.heightMm, true)
    else actions.updateItem(item.id, { heightMm: mm })
  }
  const rotate = (deg: number) => actions.updateItem(item.id, { rotationDeg: norm(item.rotationDeg + deg) })

  return (
    <div className="props-section" data-testid="item-properties">
      <h2>Design</h2>
      <p className={`dpi-badge dpi-${status}`}>
        <span>{Math.round(dpi)} dpi</span> <span>{LABELS[status]}</span>
      </p>
      <div className="source-label">
        <strong>{item.source.label}</strong>
        {item.source.customerName && <div>{item.source.customerName}</div>}
        {(item.source.orderNumber ?? item.source.orderId) && (
          <div>Order {item.source.orderNumber ?? item.source.orderId}</div>
        )}
      </div>

      <div className="props-group">
        <div className="grid-2">
          <NumberField label="Width" unit="cm" value={item.widthMm / MM_PER_CM} onCommit={setWidth} />
          <NumberField label="Height" unit="cm" value={item.heightMm / MM_PER_CM} onCommit={setHeight} />
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Lock aspect ratio"
          aria-pressed={lockAspect}
          title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
          onClick={() => setLockAspect(!lockAspect)}
        >
          {lockAspect ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      </div>

      <div className="props-group">
        <div className="button-row">
          <button type="button" aria-label="Rotate left 90 degrees" onClick={() => rotate(-90)}>
            <RotateCcw size={14} /> 90
          </button>
          <button type="button" aria-label="Rotate right 90 degrees" onClick={() => rotate(90)}>
            <RotateCw size={14} /> 90
          </button>
        </div>
        <NumberField
          label="Rotation"
          unit="°"
          decimals={1}
          value={item.rotationDeg}
          onCommit={(deg) => actions.updateItem(item.id, { rotationDeg: norm(deg) })}
        />
      </div>

      <div className="props-group toggles">
        <label>
          <input
            type="checkbox"
            checked={item.whiteEnabled}
            onChange={(e) => actions.updateItem(item.id, { whiteEnabled: e.target.checked })}
          />
          White layer
        </label>
      </div>
      {buttons}
    </div>
  )
}
