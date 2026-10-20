import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Asset, SourceRef } from '../../domain/types'
import type { ProductSummary } from '../../api/types'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import { cacheAsset } from '../../platform/tauri'
import { dpiStatus, effectiveDpi } from '../../domain/dpi'
import { printableArea } from '../../domain/geometry'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { useSettings } from '../../state/settingsStore'

const MAX_QUANTITY = 500
const LABELS = { fine: 'Good', low: 'Low', bad: 'Too low' } as const
const clampQty = (raw: string) => (raw === '' ? 0 : Math.min(MAX_QUANTITY, Math.max(0, Math.floor(Number(raw)) || 0)))

interface Props {
  product: ProductSummary
  onClose(): void
}

export function AddProductDialog({ product, onClose }: Props) {
  const { client, requireLogin } = useDtfClient()
  const thresholds = useSettings((s) => s.thresholds)
  const settings = useSheet((s) => s.sheet.settings)
  const [designUrl, setDesignUrl] = useState<string | null | undefined>(undefined)
  const [sizes, setSizes] = useState<string[]>([])
  const [asset, setAsset] = useState<Asset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [single, setSingle] = useState(1)
  const [widthCm, setWidthCm] = useState<number | null>(null)

  const maxWidthCm = useMemo(() => {
    try {
      return printableArea(settings).widthMm / 10
    } catch {
      return Infinity
    }
  }, [settings])

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(`Couldn't download "${product.name}" — try again`)
    },
    [product.name, requireLogin],
  )

  const download = useCallback(
    async (path: string): Promise<Asset | null> => {
      setLoading(true)
      setError(null)
      try {
        const url = client.absoluteUrl(path)
        const a = await cacheAsset(url, client.bearerFor(url))
        setAsset(a)
        setWidthCm((w) => w ?? Math.round(Math.min((a.widthPx / 300) * 2.54, maxWidthCm) * 100) / 100)
        return a
      } catch (e) {
        fail(e)
        return null
      } finally {
        setLoading(false)
      }
    },
    [client, maxWidthCm, fail],
  )

  useEffect(() => {
    let live = true
    setLoading(true)
    client
      .getProductPrintSource(product.id)
      .then((src) => {
        if (!live) return
        setSizes(src.sizes)
        setDesignUrl(src.designUrl)
        if (src.designUrl) void download(src.designUrl)
        else setLoading(false)
      })
      .catch((e) => {
        if (!live) return
        setLoading(false)
        fail(e)
      })
    return () => {
      live = false
    }
    // Load once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = sizes.length > 0 ? sizes.map((s) => ({ size: s as string | null, qty: quantities[s] ?? 0 })) : [{ size: null, qty: single }]
  const total = rows.reduce((n, r) => n + r.qty, 0)
  const widthMm = (widthCm ?? 0) * 10
  const heightMm = asset ? (widthMm * asset.heightPx) / asset.widthPx : 0
  const valid = !!asset && widthMm > 0 && total > 0
  const dpi = asset && widthMm > 0 ? effectiveDpi({ asset, widthMm, heightMm }) : null
  const status = dpi === null ? null : dpiStatus(dpi, thresholds)
  const noDesign = designUrl === null

  const confirm = async () => {
    const a = asset ?? (designUrl ? await download(designUrl) : null)
    if (!a || !valid) return
    const items = rows
      .filter((r) => r.qty > 0)
      .map((r) => {
        const source: SourceRef = { kind: 'gallery', id: product.id, label: r.size ? `${product.name} — ${r.size}` : product.name }
        return { asset: a, source, widthMm, heightMm, quantity: r.qty }
      })
    getSheetStore().getState().addItems(items)
    onClose()
  }

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-product-title"
        onSubmit={(e) => {
          e.preventDefault()
          void confirm()
        }}
      >
        <h2 id="add-product-title">Add {product.name}</h2>
        {noDesign && <p className="inline-error">No design file</p>}
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
        {sizes.length > 0 ? (
          sizes.map((s) => (
            <label key={s} className="dialog-field">
              Size {s}
              <input
                type="number"
                min={0}
                max={MAX_QUANTITY}
                step={1}
                aria-label={`Quantity ${s}`}
                value={quantities[s] ?? 0}
                onChange={(e) => setQuantities((q) => ({ ...q, [s]: clampQty(e.target.value) }))}
              />
            </label>
          ))
        ) : (
          <label className="dialog-field">
            Quantity
            <input type="number" min={1} max={MAX_QUANTITY} step={1} value={single} onChange={(e) => setSingle(clampQty(e.target.value))} />
          </label>
        )}
        {loading && <p className="muted">Downloading…</p>}
        {dpi !== null && status && (
          <p className={`dpi-badge dpi-${status}`}>
            <span>{Math.round(dpi)} dpi</span> <span>{LABELS[status]}</span>
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
          <button type="submit" className="primary" disabled={loading || noDesign || designUrl === undefined || total <= 0}>
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
