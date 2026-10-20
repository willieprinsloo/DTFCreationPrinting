import type { DpiThresholds, PrinterProfile, Problem, Sheet, SheetItem } from './types'
import { dpiStatus, effectiveDpi } from './dpi'
import { findProblems, itemBounds } from './geometry'

const MM_PER_INCH = 25.4
const PRN_HEADER_BYTES = 48
const PRN_PASSES_PER_LINE = 6
const LINE_ALIGN_BYTES = 32

export interface PreflightResult {
  lengthMm: number
  itemCount: number
  orderIds: string[]
  low: SheetItem[]
  bad: SheetItem[]
  problems: Problem[]
  estimatedPrnBytes: number
  canCreate: boolean
  needsConfirm: boolean
}

export function preflight(sheet: Sheet, profile: PrinterProfile, t: DpiThresholds): PreflightResult {
  const bounds = sheet.items.map(itemBounds)
  const top = Math.min(...bounds.map((b) => b.yMm))
  const bottom = Math.max(...bounds.map((b) => b.yMm + b.heightMm))
  const contentLengthMm = sheet.items.length ? bottom - top : 0

  const lines = Math.ceil((contentLengthMm / MM_PER_INCH) * profile.yDpi)
  const widthPx = Math.floor((sheet.settings.widthMm / MM_PER_INCH) * profile.xDpi)
  const bytesPerLine = Math.ceil(Math.ceil((widthPx * 2) / 8) / LINE_ALIGN_BYTES) * LINE_ALIGN_BYTES

  const low: SheetItem[] = []
  const bad: SheetItem[] = []
  for (const it of sheet.items) {
    const s = dpiStatus(effectiveDpi(it), t)
    if (s === 'low') low.push(it)
    else if (s === 'bad') bad.push(it)
  }
  const problems = findProblems(sheet)
  const orderIds = [...new Set(sheet.items.map((i) => i.source.orderId).filter((o): o is string => !!o))]
  return {
    lengthMm: contentLengthMm ? bottom + sheet.settings.margins.bottomMm : 0,
    itemCount: sheet.items.length,
    orderIds,
    low,
    bad,
    problems,
    estimatedPrnBytes: PRN_HEADER_BYTES + lines * PRN_PASSES_PER_LINE * bytesPerLine,
    canCreate: problems.length === 0 && sheet.items.length > 0,
    needsConfirm: bad.length > 0,
  }
}
