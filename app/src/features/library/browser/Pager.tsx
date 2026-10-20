import { PAGE_SIZES, type PageSize } from '../../../state/libraryPrefs'

interface Props {
  page: number
  /** Index of the first item on this page. */
  offset: number
  count: number
  total: number
  hasNext: boolean
  loading: boolean
  pageSize: PageSize
  onPageSize(n: PageSize): void
  onPage(p: number): void
}

export function Pager({ page, offset, count, total, hasNext, loading, pageSize, onPageSize, onPage }: Props) {
  return (
    <div className="lib-pager">
      <label>
        Per page{' '}
        <select aria-label="Per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <span className="muted">{count > 0 ? `Showing ${offset + 1}–${offset + count} of ${total}` : loading ? 'Loading…' : ''}</span>
      <span className="spacer" />
      <button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
        Prev
      </button>
      <button type="button" disabled={!hasNext || loading} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  )
}
