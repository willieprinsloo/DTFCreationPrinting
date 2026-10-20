import { useMemo, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { getSheetStore, useSheet } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore, useSettings } from '../../state/settingsStore'
import { preflight } from '../../domain/preflight'
import { effectiveDpi } from '../../domain/dpi'
import { InvalidSheetError } from '../../domain/geometry'
import { createPrn } from '../../platform/tauri'
import { defaultPrnName, folderOf } from '../sheets/sheetFiles'

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PreflightDialog({ onClose }: { onClose(): void }) {
  const sheet = useSheet((s) => s.sheet)
  const profiles = useSettings((s) => s.profiles)
  const activeId = useSettings((s) => s.activeProfileId)
  const thresholds = useSettings((s) => s.thresholds)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const profile = profiles.find((p) => p.id === sheet.profileId) ?? profiles.find((p) => p.id === activeId) ?? DEFAULT_PROFILE
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
      await createPrn(sheet, path)
      setDone(path)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const list = (items: typeof result.low, cls: string) =>
    items.map((i) => (
      <li key={i.id} className={cls}>
        {i.source.label} — {Math.round(effectiveDpi(i))} dpi
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
        <p>Estimated file size: {formatBytes(result.estimatedPrnBytes)}</p>
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
        {result.needsConfirm && (
          <label className="dialog-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Print anyway — I've checked the low-quality designs
          </label>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {done && <p role="status">Saved {done}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="primary" disabled={!enabled} onClick={() => void create()}>Create</button>
        </div>
      </div>
    </div>
  )
}
