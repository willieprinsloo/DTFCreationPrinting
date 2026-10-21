import { useEffect, useRef, useState } from 'react'
import { getSheetStore } from '../../state/sheetStore'
import { enhancePlan } from '../../domain/enhance'
import { dpiLabel, effectiveDpi } from '../../domain/dpi'
import type { Asset, SheetItem } from '../../domain/types'
import { assetSrc, enhanceAsset, EnhanceCancelledError, type EnhanceJob, type EnhanceKind } from '../../platform/tauri'

const KINDS: Array<{ kind: EnhanceKind; label: string; help: string }> = [
  { kind: 'artwork', label: 'Artwork & logos', help: 'Text, logos and illustrations: sharp edges and flat colours. Usually takes seconds.' },
  { kind: 'photo', label: 'Photos', help: 'Photographs and painted images. Several times slower.' },
]

/** How far the comparison zooms in, so the difference is visible at a glance. */
const ZOOM = 4

/** The original's own pixels (the preview may be shrunk); TIFFs only have the preview to show. */
const viewable = (a: Asset) => (/\.(png|jpe?g)$/i.test(a.path) ? a.path : a.previewPath)

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const cm = (mm: number) => (mm / 10).toFixed(1)

/** The same part of both images, zoomed; clicking either one moves to the clicked spot. */
function Compare({ before, after }: { before: string; after: string }) {
  const [at, setAt] = useState({ x: 50, y: 50 })
  const pane = (label: string, src: string) => (
    <figure className="enhance-pane">
      <div
        className="enhance-zoom"
        role="img"
        aria-label={`${label}, zoomed in`}
        style={{ backgroundImage: `url("${src}")`, backgroundSize: `${ZOOM * 100}%`, backgroundPosition: `${at.x}% ${at.y}%` }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: Math.round(((e.clientX - r.left) / r.width) * 100), y: Math.round(((e.clientY - r.top) / r.height) * 100) })
        }}
      />
      <figcaption>{label}</figcaption>
    </figure>
  )
  return (
    <>
      <div className="enhance-compare">
        {pane('Before', before)}
        {pane('After', after)}
      </div>
      <p className="field-help">Click a picture to look at another part of the design.</p>
    </>
  )
}

export function EnhanceDialog({ item, onClose }: { item: SheetItem; onClose(): void }) {
  const plan = enhancePlan(item)
  const [kind, setKind] = useState<EnhanceKind>('artwork')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Asset | null>(null)
  const job = useRef<EnhanceJob | null>(null)
  // Closing mid-run stops the upscaler.
  useEffect(() => () => job.current?.cancel(), [])

  const start = async () => {
    if (!plan) return
    setError(null)
    setProgress(0)
    try {
      job.current = enhanceAsset(item.asset, plan.widthPx, plan.heightPx, kind, setProgress)
      setResult(await job.current.promise)
    } catch (e) {
      if (!(e instanceof EnhanceCancelledError)) setError(errorText(e))
    } finally {
      job.current = null
      setProgress(null)
    }
  }

  const use = () => {
    if (result) getSheetStore().getState().replaceAsset(item.asset.assetId, result)
    onClose()
  }

  const copies = getSheetStore().getState().sheet.items.filter((i) => i.asset.assetId === item.asset.assetId).length
  const busy = progress !== null

  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="enhance-title">
        <h2 id="enhance-title">Enhance {item.source.label}</h2>
        {!plan ? (
          <p>This design already has enough pixels to print sharply at this size.</p>
        ) : (
          <>
            <p>
              At {cm(item.widthMm)} × {cm(item.heightMm)} cm it prints at {dpiLabel(effectiveDpi(item))}. Enhance enlarges it{' '}
              {plan.factor.toFixed(1)}× ({item.asset.widthPx} × {item.asset.heightPx} → {plan.widthPx} × {plan.heightPx} px) to print at{' '}
              {dpiLabel(plan.dpi)}, redrawing edges and detail instead of blurring them.
            </p>
            {plan.capped && (
              <p className="field-help">4× is the most it can enlarge by without making things up, so this design stays under 300 dpi. Printing it smaller would help too.</p>
            )}
            {!result && (
              <>
                <div className="seg" role="group" aria-label="Kind of design">
                  {KINDS.map((k) => (
                    <button key={k.kind} type="button" aria-pressed={kind === k.kind} disabled={busy} onClick={() => setKind(k.kind)}>
                      {k.label}
                    </button>
                  ))}
                </div>
                <p className="field-help">{KINDS.find((k) => k.kind === kind)!.help}</p>
              </>
            )}
          </>
        )}
        {busy && (
          <div className="prn-progress">
            <progress aria-label="Enhancing" value={progress} max={1} />
            <span>{Math.round(progress * 100)}%</span>
            <button type="button" onClick={() => job.current?.cancel()}>Cancel</button>
          </div>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {result && (
          <>
            <Compare before={assetSrc(viewable(item.asset))} after={assetSrc(result.path)} />
            <p className="field-help">
              The original file is kept. {copies > 1 ? `All ${copies} copies on this sheet will use the enhanced design. ` : ''}Undo switches back.
            </p>
          </>
        )}
        <div className="dialog-actions">
          {result ? (
            <>
              <button type="button" onClick={onClose}>Keep original</button>
              <button type="button" className="primary" onClick={use}>Use enhanced</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={onClose}>Close</button>
              {plan && (
                <button type="button" className="primary" disabled={busy} onClick={() => void start()}>Enhance</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
