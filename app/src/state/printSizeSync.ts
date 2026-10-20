import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { isUnsupported, type DtfClient } from '../api/dtfClient'
import type { RemotePrintSizes, RemoteSizeRow } from '../api/types'
import type { PrintSizes } from '../domain/printSizes'
import type { createSettingsStore } from './settingsStore'

/**
 * - `local`: DTF Creations has no shared print sizes yet; they stay on this PC.
 * - `shared`: in step with DTF Creations.
 * - `pending`: changed here, not uploaded yet (offline or signed out).
 */
export type PrintSizeSyncStatus = 'unknown' | 'local' | 'shared' | 'pending'

const statusStore = createStore<{ status: PrintSizeSyncStatus }>(() => ({ status: 'unknown' }))
export const getPrintSizeSyncStatus = () => statusStore.getState().status
export const usePrintSizeSyncStatus = () => useStore(statusStore, (s) => s.status)

type SettingsStore = ReturnType<typeof createSettingsStore>

const hasEntries = (ps: PrintSizes) => Object.keys(ps.byType).length > 0 || Object.keys(ps.oneSizeOnly).length > 0
const typeKey = (ps: PrintSizes, c: string) => JSON.stringify([ps.byType[c] ?? {}, ps.oneSizeOnly[c] === true])

/**
 * One round trip with DTF Creations: offer this PC's table once, upload local changes, then take the
 * server's table. Changes made while this runs stay marked and go up on the next run.
 */
export async function syncPrintSizes(client: DtfClient, settings: SettingsStore): Promise<PrintSizeSyncStatus> {
  const set = (status: PrintSizeSyncStatus) => (statusStore.setState({ status }), status)
  const st = () => settings.getState()
  try {
    let remote: RemotePrintSizes = await client.getPrintSizes()
    const { printSizes: sent, printSizesSync: sync } = st()
    if (!sync.imported) {
      // First contact: this PC's table only fills gaps, so it never overwrites another station's sizes.
      if (hasEntries(sent)) remote = await client.importPrintSizes(sent)
      await st().markPrintSizesImported()
    } else {
      for (const c of sync.dirtyTypes) {
        const other: RemoteSizeRow[] = remote.otherPositions[c] ?? []
        remote = await client.putPrintSizeType(c, { oneSizeOnly: sent.oneSizeOnly[c] === true, widths: sent.byType[c] ?? {}, otherPositions: other })
      }
      if (sync.defaultDirty) remote = await client.setDefaultPrintSize(sent.defaultSize)
    }
    // Only what is still as uploaded counts as done; anything edited meanwhile stays marked.
    const now = st().printSizes
    await st().applyServerPrintSizes(remote.printSizes, {
      types: sync.dirtyTypes.filter((c) => typeKey(now, c) === typeKey(sent, c)),
      defaultSize: sync.defaultDirty && now.defaultSize === sent.defaultSize,
    })
    const left = st().printSizesSync
    return set(left.dirtyTypes.length > 0 || left.defaultDirty ? 'pending' : 'shared')
  } catch (e) {
    if (isUnsupported(e)) return set('local')
    // Offline or signed out: keep working from this PC's copy and try again later.
    const { dirtyTypes, defaultDirty } = st().printSizesSync
    return set(dirtyTypes.length > 0 || defaultDirty ? 'pending' : getPrintSizeSyncStatus())
  }
}

/** Runs syncs one at a time; a request made while one runs triggers one more afterwards. */
export function createPrintSizeSyncer(client: DtfClient, settings: SettingsStore) {
  let running: Promise<unknown> | null = null
  let again = false
  const run = (): Promise<unknown> => {
    if (running) {
      again = true
      return running
    }
    running = syncPrintSizes(client, settings).finally(() => {
      running = null
      const rerun = again && getPrintSizeSyncStatus() !== 'local'
      again = false
      if (rerun) void run()
    })
    return running
  }
  return run
}

export function resetPrintSizeSyncStatusForTests() {
  statusStore.setState({ status: 'unknown' })
}
