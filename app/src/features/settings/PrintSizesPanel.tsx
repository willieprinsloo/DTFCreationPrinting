import { useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { ONE_SIZE, STANDARD_SIZES } from '../../domain/printSizes'
import { getSettingsStore, useSettings } from '../../state/settingsStore'
import { useLookup } from '../library/queries/useLookup'
import { useErrorHandler } from '../library/useErrorHandler'
import { usePrintSizeSyncStatus, type PrintSizeSyncStatus } from '../../state/printSizeSync'

const SYNC_TEXT: Record<PrintSizeSyncStatus, string | null> = {
  unknown: null,
  local: 'Saved on this PC only. DTF Creations can’t store print sizes yet.',
  shared: 'Shared with every print station through DTF Creations.',
  pending: 'Some changes are saved on this PC only for now. They’ll be shared when DTF Creations is reachable.',
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const COLUMNS = [...STANDARD_SIZES, ONE_SIZE]
const cellKey = (categoryId: string, size: string) => `${categoryId}|${size}`
const toCm = (mm: number | undefined) => (mm === undefined ? '' : String(Math.round(mm) / 10))

/** Settings › Print sizes: default garment size and the width table per product type × size. */
export function PrintSizesPanel() {
  const { client } = useDtfClient()
  const [lookupError, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listProductCategories, onLookupError)
  const printSizes = useSettings((s) => s.printSizes)
  const printerWidthMm = useSettings((s) => s.profiles.find((p) => p.id === s.activeProfileId)?.widthMm ?? Infinity)
  const syncText = SYNC_TEXT[usePrintSizeSyncStatus()]
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const store = () => getSettingsStore().getState()
  const run = (p: Promise<void>) => p.catch((e) => setError(`Could not save: ${errorText(e)}`))

  const valueOf = (categoryId: string, size: string) => drafts[cellKey(categoryId, size)] ?? toCm(printSizes.byType[categoryId]?.[size])

  const saveCell = (categoryId: string, typeName: string, size: string) => {
    const key = cellKey(categoryId, size)
    const raw = drafts[key]
    if (raw === undefined) return
    const label = `${typeName} · ${size}`
    if (raw.trim() === '') {
      setError(null)
      setDrafts(({ [key]: _, ...rest }) => rest)
      return void run(store().setPrintWidth(categoryId, size, null))
    }
    const mm = Number(raw) * 10
    if (!(mm > 0)) return setError(`${label}: width must be more than 0 cm`)
    if (mm > printerWidthMm) return setError(`${label}: width must be at most ${printerWidthMm / 10} cm (the printer width)`)
    setError(null)
    setDrafts(({ [key]: _, ...rest }) => rest)
    void run(store().setPrintWidth(categoryId, size, mm))
  }

  return (
    <section className="settings-section">
      <h3>Print sizes</h3>
      <p className="muted">Width the design is printed at for each garment size. Height follows the design.</p>
      {syncText && <p className="field-help" role="status">{syncText}</p>}
      <label className="dialog-field">
        Default size
        <select value={printSizes.defaultSize} onChange={(e) => void run(store().setPrintSizes({ defaultSize: e.target.value }))}>
          {STANDARD_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {(error ?? lookupError) && (
        <p className="inline-error" role="alert">
          {error ?? lookupError}
        </p>
      )}
      <div className="print-sizes-grid">
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">One size only</th>
              {COLUMNS.map((s) => (
                <th key={s} scope="col">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const only = !!printSizes.oneSizeOnly[c.id]
              return (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td>
                    <input type="checkbox" aria-label={`${c.name}: One size only`} checked={only} onChange={(e) => void run(store().setOneSizeOnly(c.id, e.target.checked))} />
                  </td>
                  {COLUMNS.map((s) => (
                    <td key={s}>
                      {(!only || s === ONE_SIZE) && (
                        <input
                          type="number"
                          min={0.1}
                          step={0.1}
                          aria-label={`${c.name} ${s} width (cm)`}
                          value={valueOf(c.id, s)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [cellKey(c.id, s)]: e.target.value }))}
                          onBlur={() => saveCell(c.id, c.name, s)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        {categories.length === 0 && !lookupError && <p className="muted">Loading product types…</p>}
      </div>
    </section>
  )
}
