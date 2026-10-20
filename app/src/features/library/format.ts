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

export const fileCount = (n: number) => (n === 1 ? '1 file' : `${n} files`)

/**
 * `Couldn't download "A", "B": <reason>` — the reason comes from the downloader (HTTP status,
 * unsupported file type…) so the user can tell a flaky connection from a file that will never work.
 */
export function downloadFailedText(names: string[], errors: unknown[]): string {
  const reasons = [...new Set(errors.map((e) => (e instanceof Error ? e.message : String(e))).filter((r) => r.trim()))]
  return `Couldn't download ${names.join(', ')}${reasons.length > 0 ? `: ${reasons.join('; ')}` : ' — try again'}`
}
