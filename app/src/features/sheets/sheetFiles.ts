import { open, save } from '@tauri-apps/plugin-dialog'
import type { Sheet } from '../../domain/types'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'
import { readTextFile, writeTextFile } from '../../platform/tauri'

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
  if (!data || data.format !== FORMAT || data.version !== 1 || !data.sheet || typeof data.sheet !== 'object') {
    throw new Error('Not a DTF Print Studio sheet')
  }
  return data.sheet as Sheet
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

export function newSheetFile() {
  const { profiles, activeProfileId } = getSettingsStore().getState()
  const profile = profiles.find((p) => p.id === activeProfileId) ?? DEFAULT_PROFILE
  getSheetStore().getState().newSheet(profile)
  currentPath = null
}

async function writeTo(path: string) {
  await writeTextFile(path, serializeSheet(getSheetStore().getState().sheet))
  currentPath = path
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
  const sheet = parseSheet(await readTextFile(path))
  getSheetStore().getState().loadSheet(sheet)
  currentPath = path
  await getSettingsStore().getState().addRecentSheet(path)
}

export async function openSheet(): Promise<void> {
  const path = await open({ multiple: false, filters: FILTERS })
  if (typeof path === 'string') await openSheetAt(path)
}
