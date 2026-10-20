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
