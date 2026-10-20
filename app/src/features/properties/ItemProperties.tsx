import { useState } from 'react'
import { Copy, Lock, LockOpen, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { dpiStatus, effectiveDpi } from '../../domain/dpi'
import type { SheetItem } from '../../domain/types'
import { ONE_SIZE, defaultWidthMm } from '../../domain/printSizes'
import { useDtfClient } from '../../api/DtfClientContext'
import { useLookup } from '../library/queries/useLookup'
import { useErrorHandler } from '../library/useErrorHandler'
import { NumberField } from './NumberField'
import { changeItemSize } from './changeSize'

const LABELS = { fine: 'Good', low: 'Low', bad: 'Too low' } as const
const MM_PER_CM = 10

function GarmentSize({ item }: { item: SheetItem }) {
  const { client } = useDtfClient()
  const [, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listProductCategories, onLookupError)
  const table = useSettings((s) => s.printSizes.byType)
  const sizes = item.source.sizes ?? []
  const size = item.source.size ?? null
  const typeName = categories.find((c) => c.id === item.source.categoryId)?.name ?? ''
  const saved = item.source.categoryId ? defaultWidthMm(table, item.source.categoryId, size) : undefined
  const showSave = !!item.source.categoryId && (saved === undefined || Math.abs(saved - item.widthMm) > 0.05)
  return (
    <div className="props-group">
      <label>
        Garment size
        <select
          value={size ?? ''}
          onChange={(e) => changeItemSize(item.id, e.target.value, typeName)}
        >
          {size === null && <option value="">{ONE_SIZE}</option>}
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {showSave && (
        <button
          type="button"
          onClick={() => void getSettingsStore().getState().setPrintWidth(item.source.categoryId!, size, item.widthMm)}
        >
          Save as default for {typeName || 'this type'} · {size ?? ONE_SIZE}
        </button>
      )}
    </div>
  )
}

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

      {item.source.productId && (item.source.sizes?.length ?? 0) > 0 && <GarmentSize item={item} />}

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
