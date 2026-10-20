/** Default print widths per product type (category id) × garment size. */

export const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] as const
/** Table key used for products without sizes. */
export const ONE_SIZE = 'One size'

/** categoryId → size label (or ONE_SIZE) → print width in mm. */
export type PrintSizeTable = Record<string, Record<string, number>>

export interface PrintSizes {
  /** Garment size quick add picks (from STANDARD_SIZES). */
  defaultSize: string
  byType: PrintSizeTable
}

export const DEFAULT_PRINT_SIZES: PrintSizes = { defaultSize: 'M', byType: {} }

const standardIndex = (size: string) => STANDARD_SIZES.findIndex((s) => s.toLowerCase() === size.trim().toLowerCase())

/**
 * The size to add: `preferred` if offered (any case); otherwise the nearest standard size
 * (ties go to the larger); otherwise the first offered size. `null` for products without sizes.
 */
export function pickSize(available: string[], preferred: string): string | null {
  if (available.length === 0) return null
  const want = preferred.trim().toLowerCase()
  const exact = available.find((s) => s.trim().toLowerCase() === want)
  if (exact !== undefined) return exact
  const target = standardIndex(preferred)
  if (target < 0) return available[0]
  let best: string | null = null
  let bestDist = Infinity
  let bestIdx = -1
  for (const s of available) {
    const i = standardIndex(s)
    if (i < 0) continue
    const d = Math.abs(i - target)
    if (d < bestDist || (d === bestDist && i > bestIdx)) {
      best = s
      bestDist = d
      bestIdx = i
    }
  }
  return best ?? available[0]
}

/** Default print width (mm) for a type and size; `size` null means One size. */
export function defaultWidthMm(table: PrintSizeTable, categoryId: string, size: string | null): number | undefined {
  return table[categoryId]?.[size ?? ONE_SIZE]
}

export const isValidWidth = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Drops anything that is not a positive width (e.g. from corrupted or older saved settings). */
export function sanitizePrintSizes(raw: unknown): PrintSizes {
  if (!isObject(raw)) return DEFAULT_PRINT_SIZES
  const defaultSize =
    typeof raw.defaultSize === 'string' && standardIndex(raw.defaultSize) >= 0 ? STANDARD_SIZES[standardIndex(raw.defaultSize)] : DEFAULT_PRINT_SIZES.defaultSize
  const byType: PrintSizeTable = {}
  if (isObject(raw.byType)) {
    for (const [cat, sizes] of Object.entries(raw.byType)) {
      if (!isObject(sizes)) continue
      const row = Object.fromEntries(Object.entries(sizes).filter(([, w]) => isValidWidth(w))) as Record<string, number>
      if (Object.keys(row).length > 0) byType[cat] = row
    }
  }
  return { defaultSize, byType }
}
