import { useEffect, useState } from 'react'
import { Copy, Lock, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { uiStore, useUi } from '../../state/uiStore'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { dpiLabel, dpiStatus, effectiveDpi } from '../../domain/dpi'
import { MIN_PRINT_MM, heightForWidth, widthForHeight } from '../../domain/geometry'
import type { SheetItem } from '../../domain/types'
import { ONE_SIZE, resolveWidthMm, widthKey } from '../../domain/printSizes'
import { useDtfClient } from '../../api/DtfClientContext'
import { useLookup } from '../library/queries/useLookup'
import { useErrorHandler } from '../library/useErrorHandler'
import { NumberField } from './NumberField'
import { changeItemSize, rememberTypeNames } from './changeSize'

const LABELS = { fine: 'Good', low: 'Low', bad: 'Too low' } as const
const MM_PER_CM = 10

function GarmentSize({ item }: { item: SheetItem }) {
  const { client } = useDtfClient()
  const [, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listProductCategories, onLookupError)
  const printSizes = useSettings((s) => s.printSizes)
  const notice = useUi((s) => s.printSizeNotice)
  useEffect(() => rememberTypeNames(categories), [categories])
  const sizes = item.source.sizes ?? []
  const size = item.source.size ?? null
  const typeName = categories.find((c) => c.id === item.source.categoryId)?.name ?? ''
  const saved = item.source.categoryId ? resolveWidthMm(printSizes, item.source.categoryId, size) : undefined
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
          onClick={() => void getSettingsStore().getState().setPrintWidth(item.source.categoryId!, widthKey(printSizes, item.source.categoryId!, size), item.widthMm)}
        >
          Save as default for {typeName || 'this type'} · {widthKey(printSizes, item.source.categoryId!, size) ?? ONE_SIZE}
        </button>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}{' '}
          <button type="button" onClick={() => uiStore.getState().openSettings('print-sizes')}>
            Open Print sizes
          </button>
        </p>
      )}
    </div>
  )
}

const MIN_MESSAGE = `Minimum size is ${MIN_PRINT_MM / MM_PER_CM} cm`

type Sized = Pick<SheetItem, 'asset' | 'widthMm' | 'heightMm'>
/** True when a print of this width (or its derived height) would be under the minimum. */
const tooSmall = (item: Sized, widthMm: number) => widthMm < MIN_PRINT_MM || heightForWidth(item, widthMm) < MIN_PRINT_MM

/** One undo step: every selected item gets the width (height follows its asset) and keeps its centre. */
function setAllWidths(selected: SheetItem[], widthMm: number) {
  const patches = selected.map((i) => {
    const heightMm = heightForWidth(i, widthMm)
    return {
      id: i.id,
      patch: {
        widthMm,
        xMm: i.xMm + i.widthMm / 2 - widthMm / 2,
        yMm: i.yMm + i.heightMm / 2 - heightMm / 2,
      },
    }
  })
  getSheetStore().getState().updateItems(patches)
}

const norm = (deg: number) => ((deg % 360) + 360) % 360

export function ItemProperties({ ids }: { ids: string[] }) {
  const item = useSheet((s) => (ids.length === 1 ? s.sheet.items.find((i) => i.id === ids[0]) : undefined))
  const allItems = useSheet((s) => s.sheet.items)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const thresholds = useSettings((s) => s.thresholds)
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

  const selected = allItems.filter((i) => ids.includes(i.id))
  const mixed = selected.some((i) => Math.abs(i.widthMm - selected[0].widthMm) >= 0.05)

  if (ids.length !== 1 || !item) {
    return (
      <div className="props-section" data-testid="item-properties">
        <h2>{ids.length} designs selected</h2>
        {ids.length >= 2 && (
          <>
            <NumberField
              label="Width for all selected (cm)"
              unit="cm"
              value={selected.length > 0 ? selected[0].widthMm / MM_PER_CM : 0}
              blank={mixed}
              placeholder={mixed ? 'Mixed' : undefined}
              onCommit={(cm) => {
                const mm = cm * MM_PER_CM
                if (!(cm > 0)) return
                if (selected.some((i) => tooSmall(i, mm))) return setSizeError(MIN_MESSAGE)
                setSizeError(null)
                setAllWidths(selected, mm)
              }}
            />
            {sizeError && <p className="muted" role="alert">{sizeError}</p>}
          </>
        )}
        {buttons}
      </div>
    )
  }

  const dpi = effectiveDpi(item)
  const status = dpiStatus(dpi, thresholds)
  const setWidth = (cm: number) => {
    if (!(cm > 0)) return
    const mm = cm * MM_PER_CM
    if (tooSmall(item, mm)) return setSizeError(MIN_MESSAGE)
    setSizeError(null)
    actions.resizeItem(item.id, mm)
  }
  const setHeight = (cm: number) => {
    if (!(cm > 0)) return
    const mm = cm * MM_PER_CM
    if (tooSmall(item, widthForHeight(item, mm))) return setSizeError(MIN_MESSAGE)
    setSizeError(null)
    actions.updateItem(item.id, { heightMm: mm })
  }
  const rotate = (deg: number) => actions.updateItem(item.id, { rotationDeg: norm(item.rotationDeg + deg) })

  return (
    <div className="props-section" data-testid="item-properties">
      <h2>Design</h2>
      <p className={`dpi-badge dpi-${status}`}>
        <span>{dpiLabel(dpi)}</span> <span>{LABELS[status]}</span>
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
        {sizeError && <p className="muted" role="alert">{sizeError}</p>}
        <p className="muted">
          <Lock size={12} aria-hidden="true" /> Proportions locked
        </p>
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

      {buttons}
    </div>
  )
}
