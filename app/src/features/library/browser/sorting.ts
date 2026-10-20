import type { OrderDateFilter } from '../../../state/libraryPrefs'

const byCreated = (a?: string, b?: string) => (!a || !b ? 0 : a < b ? -1 : a > b ? 1 : 0)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Re-orders the loaded page only. Missing dates keep the server (newest-first) order. */
export function sortItems<T>(items: T[], by: 'newest' | 'oldest' | ((x: T) => string), createdAt: (x: T) => string | undefined): T[] {
  const copy = [...items]
  if (by === 'newest') return copy.sort((a, b) => byCreated(createdAt(b), createdAt(a)))
  if (by === 'oldest') return copy.sort((a, b) => byCreated(createdAt(a), createdAt(b)))
  return copy.sort((a, b) => collator.compare(by(a), by(b)))
}

/** The `date_from` for an order date filter: local midnight as a full ISO timestamp (a bare date would mean UTC midnight). */
export function dateFromFor(filter: OrderDateFilter, now = new Date()): string | undefined {
  const days = { today: 0, '7d': 7, '30d': 30, all: null }[filter]
  if (days === null) return undefined
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
