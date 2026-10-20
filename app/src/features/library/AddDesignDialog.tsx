import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Asset, SourceRef } from '../../domain/types'
import type { GalleryDesign } from '../../api/types'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import { cacheAsset } from '../../platform/tauri'
import { PDF_NOT_INSTALLED, isPdfNotInstalled } from './pdfSupport'
import { downloadFailedText } from './format'
import { assetAspect, dpiLabel, dpiStatus, effectiveDpi, nativeSizeMm } from '../../domain/dpi'
import { printableArea } from '../../domain/geometry'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { useSettings } from '../../state/settingsStore'

const MAX_QUANTITY = 500
const LABELS = { fine: 'Good', low: 'Low', bad: 'Too low' } as const

interface Props {
  design: GalleryDesign
  customerName?: string
  onClose(): void
}

export function AddDesignDialog({ design, customerName, onClose }: Props) {
  const { client, requireLogin } = useDtfClient()
  const thresholds = useSettings((s) => s.thresholds)
  const settings = useSheet((s) => s.sheet.settings)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [quantity, setQuantity] = useState<number | null>(1)
  const [widthCm, setWidthCm] = useState<number | null>(null)

  const maxWidthCm = useMemo(() => {
    try {
      return printableArea(settings).widthMm / 10
    } catch {
      return Infinity
    }
  }, [settings])

  const fetchAsset = useCallback(async (): Promise<Asset | null> => {
    setLoading(true)
    setError(null)
    try {
      const url = client.absoluteUrl(design.imageUrl)
      const a = await cacheAsset(url, client.bearerFor(url))
      setAsset(a)
      setWidthCm((w) => w ?? Math.round(Math.min(nativeSizeMm(a).widthMm / 10, maxWidthCm) * 100) / 100)
      return a
    } catch (e) {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(isPdfNotInstalled(e) ? PDF_NOT_INSTALLED : downloadFailedText([`"${design.name}"`], [e]))
      return null
    } finally {
      setLoading(false)
    }
  }, [client, design, maxWidthCm, requireLogin])

  useEffect(() => {
    void fetchAsset()
    // Download once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const widthMm = (widthCm ?? 0) * 10
  const heightMm = asset ? widthMm * assetAspect(asset) : 0
  const valid = !!asset && widthMm > 0 && quantity !== null && quantity >= 1
  const dpi = valid ? effectiveDpi({ asset, widthMm, heightMm }) : null
  const status = dpi === null ? null : dpiStatus(dpi, thresholds)

  const confirm = async () => {
    const a = asset ?? (await fetchAsset())
    if (!a || !valid) return
    const source: SourceRef = { kind: 'gallery', id: design.id, label: design.name, ...(customerName ? { customerName } : {}) }
    getSheetStore().getState().addItems([{ asset: a, source, widthMm, heightMm, quantity: quantity! }])
    onClose()
  }

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-design-title"
        onSubmit={(e) => {
          e.preventDefault()
          void confirm()
        }}
      >
        <h2 id="add-design-title">Add {design.name}</h2>
        <label className="dialog-field">
          Print width (cm)
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={widthCm ?? ''}
            disabled={!asset}
            onChange={(e) => setWidthCm(e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <label className="dialog-field">
          Quantity
          <input type="number" min={1} max={MAX_QUANTITY} step={1} value={quantity ?? ''} onChange={(e) => setQuantity(e.target.value === '' ? null : Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(e.target.value)))))} />
        </label>
        {loading && <p className="muted">Downloading…</p>}
        {dpi !== null && status && (
          <p className={`dpi-badge dpi-${status}`}>
            <span>{dpiLabel(dpi)}</span> <span>{LABELS[status]}</span>
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={loading || (!!asset && !valid)}>
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
