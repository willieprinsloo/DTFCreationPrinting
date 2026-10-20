import { describe, expect, it } from 'vitest'
import { parseSheet, serializeSheet, defaultPrnName, sanitizeName } from './sheetFiles'
import { getSheetStore } from '../../state/sheetStore'
import { DEFAULT_PROFILE } from '../../state/settingsStore'

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
