import { useEffect, useMemo, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore, useSettings } from '../../state/settingsStore'
import { describeColour } from '../../domain/engineSettings'
import { preflight } from '../../domain/preflight'
import { dpiLabel, effectiveDpi } from '../../domain/dpi'
import { InvalidSheetError } from '../../domain/geometry'
import { createPrn, LOCAL_PRINT_HOST, PrnCancelledError, revealInFolder, SendCancelledError, sendPrn, type PrnJob, type PrnStats } from '../../platform/tauri'
import { defaultPrnName, folderOf } from '../sheets/sheetFiles'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError, type DtfClient } from '../../api/dtfClient'
import { statusLabel } from '../library/format'
import type { Sheet } from '../../domain/types'

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

interface Done { path: string; stats: PrnStats }

interface OrderUpdate {
  /** Orders that should have moved but did not (one line each). */
  failures: string[]
  /** Orders left alone because they are already past Confirmed (one line each). */
  skipped: string[]
}

/**
 * Sets each distinct order on the sheet that is still Confirmed to In production
 * (orders never move backwards: any other status is left as it is), skipping (and
 * adding to) `marked` so no order is checked or sent twice.
 */
async function markOrdersInProduction(
  sheet: Sheet,
  orderIds: string[],
  marked: Set<string>,
  client: Pick<DtfClient, 'getOrderStatus' | 'setOrderStatus'>,
  requireLogin: () => void,
): Promise<OrderUpdate> {
  const failures: string[] = []
  const skipped: string[] = []
  let askedLogin = false
  for (const id of orderIds) {
    if (marked.has(id)) continue
    const label = `Order ${sheet.items.find((i) => i.source.orderId === id)?.source.orderNumber || id}`
    try {
      const status = await client.getOrderStatus(id)
      if (status === 'confirmed') {
        await client.setOrderStatus(id, 'in_production')
      } else {
        skipped.push(`${label}: Already ${statusLabel(status).toLowerCase()} — not changed`)
      }
      marked.add(id)
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        if (!askedLogin) requireLogin()
        askedLogin = true
        failures.push(`${label}: sign in to DTF Creations and update it there`)
      } else {
        failures.push(`${label}: ${errorText(e)}`)
      }
    }
  }
  return { failures, skipped }
}

export function PreflightDialog({ onClose }: { onClose(): void }) {
  const sheet = useSheet((s) => s.sheet)
  const profiles = useSettings((s) => s.profiles)
  const activeId = useSettings((s) => s.activeProfileId)
  const thresholds = useSettings((s) => s.thresholds)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [markOrders, setMarkOrders] = useState(true)
  const [orderFailures, setOrderFailures] = useState<string[]>([])
  const [ordersSkipped, setOrdersSkipped] = useState<string[]>([])
  const [updatingOrders, setUpdatingOrders] = useState(false)
  const job = useRef<PrnJob | null>(null)
  const [sendProgress, setSendProgress] = useState<number | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const sendJob = useRef<PrnJob<number> | null>(null)
  useEffect(() => () => sendJob.current?.cancel(), [])
  /** Orders already set to In production (or found past Confirmed) from this dialog (never sent again). */
  const markedOrders = useRef(new Set<string>())
  useEffect(() => () => job.current?.cancel(), [])
  const { client, requireLogin } = useDtfClient()

  const profile = profiles.find((p) => p.id === sheet.profileId) ?? profiles.find((p) => p.id === activeId) ?? DEFAULT_PROFILE
  const colour = describeColour(profile)
  const printHost = profile.printHost?.trim() || LOCAL_PRINT_HOST

  /** Streams the finished PRN to ATools, which starts printing while it arrives. */
  const send = async (path: string) => {
    setError(null)
    setSent(null)
    setSendProgress(0)
    const j = sendPrn(path, printHost, setSendProgress)
    sendJob.current = j
    try {
      await j.promise
      setSent(`Sent to the printing software (ATools) on ${printHost === LOCAL_PRINT_HOST ? 'this computer' : printHost}.`)
    } catch (e) {
      if (!(e instanceof SendCancelledError)) setError(errorText(e))
    } finally {
      sendJob.current = null
      setSendProgress(null)
    }
  }
  const result = useMemo(() => {
    try {
      return preflight(sheet, profile, thresholds)
    } catch (e) {
      if (e instanceof InvalidSheetError) return null
      throw e
    }
  }, [sheet, profile, thresholds])

  if (!result) {
    return (
      <div className="dialog-backdrop">
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
          <h2 id="preflight-title">Create PRN</h2>
          <p className="inline-error" role="alert">Margins leave no printable width</p>
          <div className="dialog-actions"><button type="button" onClick={onClose}>Close</button></div>
        </div>
      </div>
    )
  }

  const enabled = result.canCreate && (!result.needsConfirm || confirmed) && !busy

  const create = async () => {
    setError(null)
    setDone(null)
    setOrderFailures([])
    setOrdersSkipped([])
    const folder = getSettingsStore().getState().lastPrnFolder
    const name = defaultPrnName(getSheetStore().getState().sheet.name)
    setBusy(true)
    try {
      const path = await save({
        defaultPath: folder ? `${folder.replace(/[\\/]$/, '')}/${name}` : name,
        filters: [{ name: 'PRN file', extensions: ['prn'] }],
      })
      if (!path) return
      await getSettingsStore().getState().setLastPrnFolder(folderOf(path))
      setProgress(0)
      job.current = createPrn(sheet, profile, path, setProgress)
      const stats = await job.current.promise
      setDone({ path, stats })
      setProgress(null)
      if (markOrders && result.orderIds.length > 0) {
        setUpdatingOrders(true)
        try {
          const { failures, skipped } = await markOrdersInProduction(
            sheet, result.orderIds, markedOrders.current, client, requireLogin,
          )
          setOrderFailures(failures)
          setOrdersSkipped(skipped)
          if (failures.length === 0) setMarkOrders(false)
        } finally {
          setUpdatingOrders(false)
        }
      }
    } catch (e) {
      if (!(e instanceof PrnCancelledError)) setError(errorText(e))
    } finally {
      job.current = null
      setProgress(null)
      setBusy(false)
    }
  }

  const list = (items: typeof result.low, cls: string) =>
    items.map((i) => (
      <li key={i.id} className={cls}>
        {i.source.label} — {dpiLabel(effectiveDpi(i))}
      </li>
    ))

  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
        <h2 id="preflight-title">Create PRN</h2>
        <p>
          Length {(result.lengthMm / 10).toFixed(1)} cm · {result.itemCount} {result.itemCount === 1 ? 'design' : 'designs'} ·{' '}
          {result.orderIds.length} {result.orderIds.length === 1 ? 'order' : 'orders'}
        </p>
        <p>Printed length: {(result.printedLengthMm / 10).toFixed(1)} cm</p>
        <p>Estimated file size: {formatBytes(result.estimatedPrnBytes)}</p>
        <p>
          Printer {profile.name}: {colour.text}
        </p>
        {colour.warning && <p className="inline-error">{colour.warning}</p>}
        {result.itemCount === 0 && <p className="inline-error">Add at least one design first.</p>}
        {result.problems.length > 0 && (
          <p className="inline-error">
            {result.problems.length} {result.problems.length === 1 ? 'problem' : 'problems'} to fix first: designs overlap or sit outside the printable area.
          </p>
        )}
        {result.low.length > 0 && (
          <div>
            <h3>Low quality</h3>
            <ul>{list(result.low, 'warn')}</ul>
          </div>
        )}
        {result.bad.length > 0 && (
          <div>
            <h3>Too low quality</h3>
            <ul>{list(result.bad, 'bad')}</ul>
          </div>
        )}
        {result.pdfNotes.length > 0 && (
          <div>
            <h3>Notes</h3>
            <ul>
              {result.pdfNotes.map(({ item, dpi }) => (
                <li key={item.id}>
                  {item.source.label} — PDF too large for full printer resolution; printed at {Math.floor(dpi)} dpi
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.needsConfirm && (
          <label className="dialog-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Print anyway — I've checked the low-quality designs
          </label>
        )}
        {result.orderIds.length > 0 && (
          <label className="dialog-check">
            <input type="checkbox" checked={markOrders} disabled={busy} onChange={(e) => setMarkOrders(e.target.checked)} />
            Mark {result.orderIds.length} {result.orderIds.length === 1 ? 'order' : 'orders'} as In production in DTF Creations
          </label>
        )}
        {progress !== null && (
          <div className="prn-progress">
            <progress aria-label="Creating PRN" value={progress} max={1} />
            <span>{Math.round(progress * 100)}%</span>
            <button type="button" onClick={() => job.current?.cancel()}>Cancel</button>
          </div>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {done && (
          <p role="status">
            Saved {fileName(done.path)} ({formatBytes(done.stats.bytes)}, {Math.max(1, Math.round(done.stats.millis / 1000))} s){' '}
            <button type="button" onClick={() => void revealInFolder(done.path).catch((e) => setError(errorText(e)))}>Show in folder</button>{' '}
            <button type="button" className="primary" disabled={sendProgress !== null} onClick={() => void send(done.path)}>
              Send to printer
            </button>
          </p>
        )}
        {sendProgress !== null && (
          <div className="prn-progress">
            <progress aria-label="Sending to printer" value={sendProgress} max={1} />
            <span>{Math.round(sendProgress * 100)}%</span>
            <button type="button" onClick={() => sendJob.current?.cancel()}>Stop sending</button>
          </div>
        )}
        {sent && <p role="status">{sent}</p>}
        {updatingOrders && <p role="status">Updating orders in DTF Creations…</p>}
        {ordersSkipped.length > 0 && (
          <div>
            <p>These orders are already past Confirmed, so they were left as they are:</p>
            <ul aria-label="Orders not changed">
              {ordersSkipped.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
        {orderFailures.length > 0 && (
          <div>
            <p className="inline-error">The PRN was created, but these orders were not set to In production:</p>
            <ul aria-label="Orders not updated">
              {orderFailures.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>Close</button>
          <button type="button" className="primary" disabled={!enabled} onClick={() => void create()}>Create</button>
        </div>
      </div>
    </div>
  )
}
