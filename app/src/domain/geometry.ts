import type { Problem, Rect, Sheet, SheetItem, SheetSettings } from './types'

const OVERLAP_EPSILON_MM = 0.01

export class InvalidSheetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSheetError'
  }
}

export function printableArea(s: SheetSettings): Rect {
  const { leftMm, rightMm, topMm } = s.margins
  const widthMm = s.widthMm - leftMm - rightMm
  if (widthMm <= 0) throw new InvalidSheetError('Margins leave no printable width on this sheet')
  return {
    xMm: leftMm,
    yMm: topMm,
    widthMm,
    heightMm: s.lengthMode === 'fixed' ? s.fixedLengthMm - topMm - s.margins.bottomMm : Infinity,
  }
}

/** Axis-aligned bounding box after rotating about the item centre. */
export function itemBounds(item: SheetItem): Rect {
  const rad = (item.rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const widthMm = item.widthMm * cos + item.heightMm * sin
  const heightMm = item.widthMm * sin + item.heightMm * cos
  const cx = item.xMm + item.widthMm / 2
  const cy = item.yMm + item.heightMm / 2
  return { xMm: cx - widthMm / 2, yMm: cy - heightMm / 2, widthMm, heightMm }
}

export function sheetLengthMm(sheet: Sheet): number {
  const { settings } = sheet
  if (settings.lengthMode === 'fixed') return settings.fixedLengthMm
  const { topMm, bottomMm } = settings.margins
  const lowest = sheet.items.reduce((max, it) => {
    const b = itemBounds(it)
    return Math.max(max, b.yMm + b.heightMm)
  }, 0)
  return Math.max(lowest + bottomMm, topMm + bottomMm)
}

export function findProblems(sheet: Sheet): Problem[] {
  const area = printableArea(sheet.settings)
  const bounds = sheet.items.map(itemBounds)
  const problems: Problem[] = []
  const eps = OVERLAP_EPSILON_MM

  sheet.items.forEach((it, i) => {
    const b = bounds[i]
    if (b.xMm < area.xMm - eps || b.xMm + b.widthMm > area.xMm + area.widthMm + eps || b.yMm < area.yMm - eps) {
      problems.push({ kind: 'outside', itemId: it.id })
    }
  })
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i], b = bounds[j]
      const ox = Math.min(a.xMm + a.widthMm, b.xMm + b.widthMm) - Math.max(a.xMm, b.xMm)
      const oy = Math.min(a.yMm + a.heightMm, b.yMm + b.heightMm) - Math.max(a.yMm, b.yMm)
      if (ox > eps && oy > eps) problems.push({ kind: 'overlap', itemIds: [sheet.items[i].id, sheet.items[j].id] })
    }
  }
  return problems
}
