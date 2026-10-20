import { ask, open, save } from '@tauri-apps/plugin-dialog'
import type { Sheet } from '../../domain/types'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import { readSheetFile, writeSheetFile } from '../../platform/tauri'

const FORMAT = 'dtf-print-studio-sheet'
const FILTERS = [{ name: 'DTF Print Studio sheet', extensions: ['dtfsheet'] }]

export function serializeSheet(sheet: Sheet): string {
  return JSON.stringify({ format: FORMAT, version: 1, sheet })
}

export function parseSheet(text: string): Sheet {
  let data: { format?: unknown; version?: unknown; sheet?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a DTF Print Studio sheet')
  }
  const sh = data?.sheet as Partial<Sheet> | undefined
  const valid =
    data?.format === FORMAT &&
    data.version === 1 &&
    !!sh &&
    typeof sh.id === 'string' &&
    typeof sh.name === 'string' &&
    !!sh.settings &&
    typeof sh.settings === 'object' &&
    typeof sh.settings.widthMm === 'number' &&
    !!sh.settings.margins &&
    typeof sh.settings.margins === 'object' &&
    Array.isArray(sh.items)
  if (!valid) throw new Error('Not a DTF Print Studio sheet')
  return sh as Sheet
}

export const sanitizeName = (name: string) => name.replace(/[^A-Za-z0-9 _-]/g, '').trim()

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYYMMDD-HHMM_<sheet-name>.prn` in local time. */
export function defaultPrnName(sheetName: string, now = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${stamp}_${sanitizeName(sheetName) || 'sheet'}.prn`
}

export const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

let currentPath: string | null = null
/** The sheet object as of the last new/load/save; any edit replaces the sheet reference. */
let savedSheet: Sheet | null = getSheetStore().getState().sheet

const markClean = () => {
  savedSheet = getSheetStore().getState().sheet
}

export const isDirty = () => getSheetStore().getState().sheet !== savedSheet

/** True when it is fine to replace the current sheet (clean, or the user agreed to discard). */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true
  const { name } = getSheetStore().getState().sheet
  return ask(`Discard unsaved changes to ${name}?`, { title: 'Unsaved changes', kind: 'warning' })
}

export async function newSheetFile() {
  if (!(await confirmDiscard())) return
  const { profiles, activeProfileId } = getSettingsStore().getState()
  const profile = profiles.find((p) => p.id === activeProfileId) ?? DEFAULT_PROFILE
  getSheetStore().getState().newSheet(profile)
  currentPath = null
  markClean()
}

async function writeTo(path: string) {
  const sheet = getSheetStore().getState().sheet
  await writeSheetFile(path, serializeSheet(sheet))
  currentPath = path
  savedSheet = sheet
  await getSettingsStore().getState().addRecentSheet(path)
}

export async function saveSheetAs(): Promise<void> {
  const name = sanitizeName(getSheetStore().getState().sheet.name) || 'sheet'
  const path = await save({ defaultPath: `${name}.dtfsheet`, filters: FILTERS })
  if (path) await writeTo(path.endsWith('.dtfsheet') ? path : `${path}.dtfsheet`)
}

export async function saveSheet(): Promise<void> {
  if (currentPath) await writeTo(currentPath)
  else await saveSheetAs()
}

export async function openSheetAt(path: string): Promise<void> {
  if (!(await confirmDiscard())) return
  const sheet = parseSheet(await readSheetFile(path))
  getSheetStore().getState().loadSheet(sheet)
  currentPath = path
  markClean()
  await getSettingsStore().getState().addRecentSheet(path)
}

export async function openSheet(): Promise<void> {
  const path = await open({ multiple: false, filters: FILTERS })
  if (typeof path === 'string') await openSheetAt(path)
}
