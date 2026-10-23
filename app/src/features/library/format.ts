/** "20 Oct 2026", or '' for a missing/invalid date. */
export const formatDate = (iso: string | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "in_production" → "In production"; unknown statuses get underscores as spaces and a capital first letter. */
export const statusLabel = (status: string) => {
  const s = status.replace(/_/g, ' ').trim().toLowerCase()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

/** A type from the server for showing under a picture: "t_shirt" → "T shirt", "dtf" → "DTF"; names already written for people are kept. */
export const typeLabel = (raw: string | undefined) => {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/[A-Z ]/.test(s)) return s
  const words = s
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((w) => (ABBREVIATIONS.has(w) ? w.toUpperCase() : w))
    .join(' ')
  return words[0].toUpperCase() + words.slice(1)
}

const ABBREVIATIONS = new Set(['dtf', 'dtg', 'uv', 'a3', 'a4', 'a5', 'a6'])

/** The different types among an order's files, e.g. "T shirt, Mug". */
export const fileTypes = (files: { productType: string }[]) => [...new Set(files.map((f) => typeLabel(f.productType)).filter(Boolean))].join(', ')

export const fileCount = (n: number) => (n === 1 ? '1 file' : `${n} files`)

/**
 * `Couldn't download "A", "B": <reason>` — the reason comes from the downloader (HTTP status,
 * unsupported file type…) so the user can tell a flaky connection from a file that will never work.
 */
export function downloadFailedText(names: string[], errors: unknown[]): string {
  const reasons = [...new Set(errors.map((e) => (e instanceof Error ? e.message : String(e))).filter((r) => r.trim()))]
  return `Couldn't download ${names.join(', ')}${reasons.length > 0 ? `: ${reasons.join('; ')}` : ' — try again'}`
}
