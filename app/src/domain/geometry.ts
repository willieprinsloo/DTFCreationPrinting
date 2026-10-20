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
  let heightMm = Infinity
  if (s.lengthMode === 'fixed') {
    heightMm = s.fixedLengthMm - topMm - s.margins.bottomMm
    if (heightMm <= 0) throw new InvalidSheetError('Margins leave no printable length on this sheet')
  }
  return { xMm: leftMm, yMm: topMm, widthMm, heightMm }
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

/** Length drawn on screen: the real length, but never shorter than the preview minimum in auto mode. */
export function displayLengthMm(sheet: Sheet, minPreviewMm: number): number {
  if (sheet.settings.lengthMode === 'fixed') return sheet.settings.fixedLengthMm
  return Math.max(sheetLengthMm(sheet), minPreviewMm)
}

export function findProblems(sheet: Sheet): Problem[] {
  const area = printableArea(sheet.settings)
  const bounds = sheet.items.map(itemBounds)
  const problems: Problem[] = []
  const eps = OVERLAP_EPSILON_MM

  sheet.items.forEach((it, i) => {
    const b = bounds[i]
    if (
      b.xMm < area.xMm - eps || b.xMm + b.widthMm > area.xMm + area.widthMm + eps || b.yMm < area.yMm - eps ||
      b.yMm + b.heightMm > area.yMm + area.heightMm + eps
    ) {
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

type Sized = Pick<SheetItem, 'asset' | 'widthMm' | 'heightMm'>

/** Print aspect (height / width) is always the source image's; falls back to the item's own if the asset has no size. */
function aspect(item: Sized): number {
  const { widthPx, heightPx } = item.asset
  return widthPx > 0 && heightPx > 0 ? heightPx / widthPx : item.heightMm / item.widthMm
}

export const heightForWidth = (item: Sized, widthMm: number): number => widthMm * aspect(item)
export const widthForHeight = (item: Sized, heightMm: number): number => heightMm / aspect(item)

/**
 * New print size after a canvas transform. Scales on both axes may disagree (side handles); the one that moved
 * furthest from 1 wins and the height is derived from the width.
 */
export function sizeAfterTransform(item: Sized, scaleX: number, scaleY: number): { widthMm: number; heightMm: number } {
  const sx = Math.abs(scaleX)
  const sy = Math.abs(scaleY)
  const widthMm = Math.abs(sy - 1) > Math.abs(sx - 1) ? widthForHeight(item, item.heightMm * sy) : item.widthMm * sx
  return { widthMm, heightMm: heightForWidth(item, widthMm) }
}

/** Keeps each item's width and re-derives its height; returns the same sheet when nothing was distorted. */
export function normaliseSheetAspect(sheet: Sheet): Sheet {
  let changed = false
  const items = sheet.items.map((it) => {
    const heightMm = heightForWidth(it, it.widthMm)
    if (Math.abs(heightMm - it.heightMm) < 1e-6) return it
    changed = true
    return { ...it, heightMm }
  })
  return changed ? { ...sheet, items } : sheet
}
