import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { isUnsupported, type DtfClient } from '../api/dtfClient'
import type { PrintMedia, PrintMediaSize, ProductCategory } from '../api/types'
import { ONE_SIZE, type PrintSizes } from '../domain/printSizes'
import type { createSettingsStore } from './settingsStore'

/**
 * - `local`: DTF Creations has no print media endpoint; sizes stay on this PC.
 * - `shared`: in step with DTF Creations' print media.
 * - `pending`: changed here, not uploaded yet (offline or signed out).
 */
export type PrintSizeSyncStatus = 'unknown' | 'local' | 'shared' | 'pending'

const statusStore = createStore<{ status: PrintSizeSyncStatus }>(() => ({ status: 'unknown' }))
export const getPrintSizeSyncStatus = () => statusStore.getState().status
export const usePrintSizeSyncStatus = () => useStore(statusStore, (s) => s.status)

type SettingsStore = ReturnType<typeof createSettingsStore>
type WidthTable = Omit<PrintSizes, 'defaultSize'>

/**
 * Print media needs a height for every size, but the app sizes by width only (height follows the
 * design). New sizes get this portrait print zone; heights already on the server are kept.
 */
export const DEFAULT_ZONE_RATIO = 1.25
/** Per-size extra field marking a media printed at its One size width whatever the garment size. */
const ONE_SIZE_ONLY = 'one_size_only'

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const appLabel = (label: string) => (sameLabel(label, ONE_SIZE) ? ONE_SIZE : label.trim())

/** The app's width table from print media whose slug matches a catalogue category. */
export function widthsFromMedia(media: PrintMedia[], categories: ProductCategory[]): WidthTable {
  const byType: WidthTable['byType'] = {}
  const oneSizeOnly: WidthTable['oneSizeOnly'] = {}
  for (const c of categories) {
    const slug = c.slug?.toLowerCase()
    const m = slug ? media.find((x) => x.slug === slug) : undefined
    if (!m) continue
    for (const s of m.sizes) (byType[c.id] ??= {})[appLabel(s.label)] = s.print_width_mm
    if (m.sizes.some((s) => s[ONE_SIZE_ONLY] === true)) oneSizeOnly[c.id] = true
  }
  return { byType, oneSizeOnly }
}

/**
 * The sizes to store for one media. `replace`: exactly the local widths (a size cleared here is
 * removed). `fill`: the server's sizes, plus local ones it lacks. Heights and extra fields of
 * existing sizes are kept either way.
 */
export function mediaSizes(existing: PrintMediaSize[], widths: Record<string, number>, oneSizeOnly: boolean, mode: 'replace' | 'fill'): PrintMediaSize[] {
  const find = (label: string) => existing.find((s) => sameLabel(s.label, label))
  const local = Object.entries(widths).map(([label, w]): PrintMediaSize => {
    const old = find(label)
    return { ...old, label: old?.label ?? label, print_width_mm: w, print_height_mm: old?.print_height_mm || Math.round(w * DEFAULT_ZONE_RATIO) }
  })
  const sizes = mode === 'replace' ? local : [...existing, ...local.filter((l) => !find(l.label))]
  return sizes.map(({ [ONE_SIZE_ONLY]: _, ...s }) => (oneSizeOnly ? { ...s, [ONE_SIZE_ONLY]: true } : s) as PrintMediaSize)
}

const typeKey = (ps: WidthTable, c: string) => JSON.stringify([ps.byType[c] ?? {}, ps.oneSizeOnly[c] === true])
const hasType = (ps: WidthTable, c: string) => Object.keys(ps.byType[c] ?? {}).length > 0 || ps.oneSizeOnly[c] === true

/**
 * One round trip with DTF Creations: on first contact this PC's widths fill gaps in the shared print
 * media; after that, types changed here are uploaded. Then the server's widths are taken. Changes
 * made while this runs stay marked and go up on the next run.
 */
export async function syncPrintSizes(client: DtfClient, settings: SettingsStore): Promise<PrintSizeSyncStatus> {
  const set = (status: PrintSizeSyncStatus) => (statusStore.setState({ status }), status)
  const st = () => settings.getState()
  try {
    const [media, categories] = await Promise.all([client.listPrintMedia(), client.listProductCategories()])
    const { printSizes: sent, printSizesSync: sync } = st()
    const mode = sync.imported ? 'replace' : 'fill'
    const types = sync.imported ? sync.dirtyTypes : [...new Set([...sync.dirtyTypes, ...Object.keys(sent.byType), ...Object.keys(sent.oneSizeOnly)])]
    for (const c of types) {
      const cat = categories.find((x) => x.id === c)
      if (!cat?.slug) continue // Category gone from the catalogue: nothing to share.
      const slug = cat.slug.toLowerCase()
      const old = media.find((m) => m.slug === slug)
      if (!old && !hasType(sent, c)) continue
      const sizes = mediaSizes(old?.sizes ?? [], sent.byType[c] ?? {}, sent.oneSizeOnly[c] === true, mode)
      if (old && JSON.stringify(sizes) === JSON.stringify(old.sizes)) continue
      const saved = await client.putPrintMedia(slug, { name: old?.name ?? cat.name, sizes })
      const next = saved.slug ? saved : { slug, name: old?.name ?? cat.name, sizes }
      media.splice(old ? media.indexOf(old) : media.length, old ? 1 : 0, next)
    }
    if (!sync.imported) await st().markPrintSizesImported()
    // Only what is still as uploaded counts as done; anything edited meanwhile stays marked.
    const now = st().printSizes
    await st().applyServerPrintSizes(
      widthsFromMedia(media, categories),
      sync.dirtyTypes.filter((c) => typeKey(now, c) === typeKey(sent, c)),
    )
    return set(st().printSizesSync.dirtyTypes.length > 0 ? 'pending' : 'shared')
  } catch (e) {
    if (isUnsupported(e)) return set('local')
    // Offline or signed out: keep working from this PC's copy and try again later.
    return set(st().printSizesSync.dirtyTypes.length > 0 ? 'pending' : getPrintSizeSyncStatus())
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
