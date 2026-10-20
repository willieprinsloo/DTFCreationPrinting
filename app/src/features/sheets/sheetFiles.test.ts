import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSheet, serializeSheet, defaultPrnName, sanitizeName, newSheetFile, openSheetAt, saveSheet, adoptActiveProfile, isDirty } from './sheetFiles'
import { ask, save } from '@tauri-apps/plugin-dialog'
import { readSheetFile, writeSheetFile } from '../../platform/tauri'

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), save: vi.fn(), open: vi.fn() }))
vi.mock('../../platform/tauri', () => ({ readSheetFile: vi.fn(), writeSheetFile: vi.fn() }))
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE, getSettingsStore } from '../../state/settingsStore'

describe('sheet files', () => {
  it('round-trips a sheet', () => {
    getSheetStore().getState().newSheet(DEFAULT_PROFILE, 'Order 12')
    const { sheet } = getSheetStore().getState()
    const text = serializeSheet(sheet)
    expect(JSON.parse(text)).toMatchObject({ format: 'dtf-print-studio-sheet', version: 1 })
    expect(parseSheet(text)).toEqual(sheet)
  })

  it('rejects other files', () => {
    expect(() => parseSheet('{"format":"x"}')).toThrow('Not a DTF Print Studio sheet')
    expect(() => parseSheet('{"format":"dtf-print-studio-sheet","version":2,"sheet":{}}')).toThrow('Not a DTF Print Studio sheet')
    expect(() => parseSheet('nonsense')).toThrow('Not a DTF Print Studio sheet')
  })

  it('builds the default PRN name from local time and a sanitised sheet name', () => {
    expect(sanitizeName('Order #12/ab')).toBe('Order 12ab')
    expect(defaultPrnName('Order #12', new Date(2026, 9, 20, 9, 5))).toBe('20261020-0905_Order 12.prn')
  })
})

describe('parseSheet shape validation', () => {
  const wrap = (sheet: unknown) => JSON.stringify({ format: 'dtf-print-studio-sheet', version: 1, sheet })
  it('rejects a sheet without items or settings', () => {
    expect(() => parseSheet(wrap({ id: 'a', name: 'n', settings: { widthMm: 600, margins: {} } }))).toThrow('Not a DTF Print Studio sheet')
    expect(() => parseSheet(wrap({ id: 'a', name: 'n', items: [] }))).toThrow('Not a DTF Print Studio sheet')
    expect(() => parseSheet(wrap({ id: 1, name: 'n', items: [], settings: { widthMm: 600, margins: {} } }))).toThrow('Not a DTF Print Studio sheet')
    expect(() => parseSheet(wrap(null))).toThrow('Not a DTF Print Studio sheet')
  })

  it('accepts items with or without the product size fields', () => {
    const settings = { widthMm: 600, margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 } }
    const item = (source: object) => ({ id: 'i', asset: {}, source, xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, rotationDeg: 0, whiteEnabled: true })
    const old = { kind: 'gallery', id: 'p1', label: 'Tee — M' }
    const withSize = { ...old, productId: 'p1', categoryId: '3', size: 'M', sizes: ['S', 'M'] }
    const sheet = parseSheet(wrap({ id: 'a', name: 'n', settings, items: [item(old), item(withSize)] }))
    expect(sheet.items[0].source).toEqual(old)
    expect(sheet.items[1].source).toEqual(withSize)
  })
})

describe('unsaved changes guard', () => {
  beforeEach(async () => {
    vi.mocked(ask).mockReset()
    vi.mocked(save).mockResolvedValue('/s/job.dtfsheet')
    vi.mocked(writeSheetFile).mockResolvedValue(undefined)
    getSettingsStore().setState({ addRecentSheet: vi.fn().mockResolvedValue(undefined) })
    vi.mocked(ask).mockResolvedValue(true)
    await newSheetFile() // reset to a clean state
    vi.mocked(ask).mockReset()
  })

  const edit = () => getSheetStore().setState({ sheet: { ...getSheetStore().getState().sheet, name: 'Edited' } })

  it('does not prompt when the sheet is clean', async () => {
    await newSheetFile()
    expect(ask).not.toHaveBeenCalled()
  })

  it('keeps a dirty sheet when the user cancels', async () => {
    edit()
    vi.mocked(ask).mockResolvedValue(false)
    await newSheetFile()
    expect(ask).toHaveBeenCalledWith('Discard unsaved changes to Edited?', expect.anything())
    expect(getSheetStore().getState().sheet.name).toBe('Edited')
    await openSheetAt('/s/other.dtfsheet')
    expect(readSheetFile).not.toHaveBeenCalled()
  })

  it('replaces a dirty sheet when the user agrees, and saving makes it clean', async () => {
    edit()
    vi.mocked(ask).mockResolvedValue(true)
    await newSheetFile()
    expect(getSheetStore().getState().sheet.name).toBe('Untitled sheet')
    edit()
    await saveSheet()
    await newSheetFile()
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe('adoptActiveProfile (startup sheet)', () => {
  const p300 = { ...DEFAULT_PROFILE, id: 'p300', name: 'Narrow', widthMm: 300 }
  const startup = () => ({ ...getSheetStore().getState().sheet, profileId: 'default', items: [] })
  beforeEach(async () => {
    getSettingsStore().setState({ profiles: [p300], activeProfileId: 'p300' })
    vi.mocked(ask).mockResolvedValue(true)
    await newSheetFile()
  })

  it('replaces the untouched startup sheet with the active profile and marks it clean', () => {
    getSheetStore().setState({ sheet: startup() })
    adoptActiveProfile()
    const sh = getSheetStore().getState().sheet
    expect(sh.settings.widthMm).toBe(300)
    expect(sh.profileId).toBe('p300')
    expect(isDirty()).toBe(false)
  })

  it('does not replace a sheet that has items', () => {
    const base = startup()
    const withItem = { ...base, items: [{ id: 'i' } as never] }
    getSheetStore().setState({ sheet: withItem })
    adoptActiveProfile()
    expect(getSheetStore().getState().sheet).toBe(withItem)
  })
})
