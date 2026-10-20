import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Asset, SourceRef } from '../../domain/types'
import type { ProductSummary } from '../../api/types'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import { cacheAsset } from '../../platform/tauri'
import { PDF_NOT_INSTALLED, isPdfNotInstalled } from './pdfSupport'
import { assetAspect, dpiLabel, dpiStatus, effectiveDpi, nativeSizeMm } from '../../domain/dpi'
import { printableArea } from '../../domain/geometry'
import { ONE_SIZE, resolveWidthMm } from '../../domain/printSizes'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { useSettings } from '../../state/settingsStore'
import { useProductSources } from './queries/useProductSources'

const MAX_QUANTITY = 500
const LABELS = { fine: 'Good', low: 'Low', bad: 'Too low' } as const
const clampQty = (raw: string) => (raw === '' ? 0 : Math.min(MAX_QUANTITY, Math.max(0, Math.floor(Number(raw)) || 0)))

interface Props {
  product: ProductSummary
  onClose(): void
}

export function AddProductDialog({ product, onClose }: Props) {
  const { client, requireLogin } = useDtfClient()
  const sources = useProductSources()
  const thresholds = useSettings((s) => s.thresholds)
  const printSizes = useSettings((s) => s.printSizes)
  const settings = useSheet((s) => s.sheet.settings)
  const [designUrl, setDesignUrl] = useState<string | null | undefined>(undefined)
  const [sizes, setSizes] = useState<string[]>([])
  const [asset, setAsset] = useState<Asset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [single, setSingle] = useState(1)
  /** Per-size print width in cm (key ONE_SIZE for products without sizes); unset rows use the native width. */
  const [widthsCm, setWidthsCm] = useState<Record<string, number | null>>({})
  const [nativeCm, setNativeCm] = useState<number | null>(null)

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
      setError(isPdfNotInstalled(e) ? PDF_NOT_INSTALLED : `Couldn't download "${product.name}" — try again`)
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
        setNativeCm(Math.round(Math.min(nativeSizeMm(a).widthMm / 10, maxWidthCm) * 100) / 100)
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
    sources
      .get(product.id)
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

  const widthCmOf = (size: string | null): number | null => {
    const key = size ?? ONE_SIZE
    if (key in widthsCm) return widthsCm[key]
    const mm = resolveWidthMm(printSizes, product.categoryId, size)
    return mm !== undefined ? mm / 10 : nativeCm
  }
  const rows = (sizes.length > 0 ? sizes.map((s) => ({ size: s as string | null, qty: quantities[s] ?? 0 })) : [{ size: null, qty: single }]).map(
    (r) => {
      const widthMm = (widthCmOf(r.size) ?? 0) * 10
      const heightMm = asset ? widthMm * assetAspect(asset) : 0
      const dpi = asset && widthMm > 0 ? effectiveDpi({ asset, widthMm, heightMm }) : null
      return { ...r, widthMm, heightMm, dpi, status: dpi === null ? null : dpiStatus(dpi, thresholds) }
    },
  )
  const total = rows.reduce((n, r) => n + r.qty, 0)
  const valid = !!asset && total > 0 && rows.every((r) => r.qty === 0 || r.widthMm > 0)
  const noDesign = designUrl === null

  const confirm = async () => {
    const a = asset ?? (designUrl ? await download(designUrl) : null)
    if (!a || !valid) return
    const items = rows
      .filter((r) => r.qty > 0)
      .map((r) => {
        const source: SourceRef = {
          kind: 'gallery',
          id: product.id,
          productId: product.id,
          categoryId: product.categoryId,
          size: r.size,
          sizes,
          label: r.size ? `${product.name} — ${r.size}` : product.name,
        }
        return { asset: a, source, widthMm: r.widthMm, heightMm: r.heightMm, quantity: r.qty }
      })
    getSheetStore().getState().addItems(items)
    onClose()
  }

  const widthInput = (size: string | null, label?: string) => {
    const cm = widthCmOf(size)
    return (
      <input
        type="number"
        min={0.1}
        step={0.1}
        aria-label={label}
        value={cm ?? ''}
        disabled={!asset}
        onChange={(e) => setWidthsCm((w) => ({ ...w, [size ?? ONE_SIZE]: e.target.value === '' ? null : Number(e.target.value) }))}
      />
    )
  }
  const dpiBadge = (r: (typeof rows)[number]) =>
    r.dpi !== null &&
    r.status && (
      <p className={`dpi-badge dpi-${r.status}`}>
        <span>{dpiLabel(r.dpi)}</span> <span>{LABELS[r.status]}</span>
      </p>
    )

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
        {sizes.length > 0 ? (
          <table className="size-rows">
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">Quantity</th>
                <th scope="col">Width (cm)</th>
                <th scope="col">Quality</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.size}>
                  <th scope="row">{r.size}</th>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={MAX_QUANTITY}
                      step={1}
                      aria-label={`Quantity ${r.size}`}
                      value={r.qty}
                      onChange={(e) => setQuantities((q) => ({ ...q, [r.size!]: clampQty(e.target.value) }))}
                    />
                  </td>
                  <td>{widthInput(r.size, `Width ${r.size} (cm)`)}</td>
                  <td>{dpiBadge(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <label className="dialog-field">
              Print width (cm)
              {widthInput(null)}
            </label>
            <label className="dialog-field">
              Quantity
              <input type="number" min={1} max={MAX_QUANTITY} step={1} value={single} onChange={(e) => setSingle(clampQty(e.target.value))} />
            </label>
            {dpiBadge(rows[0])}
          </>
        )}
        {loading && <p className="muted">Downloading…</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={loading || noDesign || designUrl === undefined || (!!asset && !valid) || total <= 0}>
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
