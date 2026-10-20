import type { DpiThresholds, PrinterProfile, Problem, Sheet, SheetItem } from './types'
import { dpiStatus, effectiveDpi, pdfPrintedDpi } from './dpi'
import { findProblems, itemBounds } from './geometry'

const MM_PER_INCH = 25.4
const PRN_HEADER_BYTES = 48
const PRN_PASSES_PER_LINE = 6
const LINE_ALIGN_BYTES = 32

export interface PreflightResult {
  /** Sheet length: lowest design plus the bottom margin. */
  lengthMm: number
  /** Length the PRN will print: the content trimmed to the designs, plus the lead-in (0 when empty). */
  printedLengthMm: number
  itemCount: number
  orderIds: string[]
  low: SheetItem[]
  bad: SheetItem[]
  /** PDFs too large to print at full printer resolution, with the dpi they will print at. */
  pdfNotes: { item: SheetItem; dpi: number }[]
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

  // Lines as the engine counts them (render_prn): whole lines from the top design
  // edge to the bottom one, plus the lead-in.
  const dy = MM_PER_INCH / profile.yDpi
  const leadLines = Math.ceil(Math.max(0, profile.leadInMm ?? 0) / dy)
  const lines = sheet.items.length ? Math.ceil(bottom / dy) - Math.floor(top / dy) + leadLines : 0
  const widthPx = Math.floor((sheet.settings.widthMm / MM_PER_INCH) * profile.xDpi)
  const bytesPerLine = Math.ceil(Math.ceil((widthPx * 2) / 8) / LINE_ALIGN_BYTES) * LINE_ALIGN_BYTES

  const low: SheetItem[] = []
  const bad: SheetItem[] = []
  for (const it of sheet.items) {
    const s = dpiStatus(effectiveDpi(it), t)
    if (s === 'low') low.push(it)
    else if (s === 'bad') bad.push(it)
  }
  const pdfNotes = sheet.items.flatMap((item) => {
    const dpi = pdfPrintedDpi(item, profile)
    return dpi === null ? [] : [{ item, dpi }]
  })
  const problems = findProblems(sheet)
  const orderIds = [...new Set(sheet.items.map((i) => i.source.orderId).filter((o): o is string => !!o))]
  return {
    lengthMm: contentLengthMm ? bottom + sheet.settings.margins.bottomMm : 0,
    printedLengthMm: lines * dy,
    itemCount: sheet.items.length,
    orderIds,
    low,
    bad,
    pdfNotes,
    problems,
    estimatedPrnBytes: PRN_HEADER_BYTES + lines * PRN_PASSES_PER_LINE * bytesPerLine,
    canCreate: problems.length === 0 && sheet.items.length > 0,
    needsConfirm: bad.length > 0,
  }
}
