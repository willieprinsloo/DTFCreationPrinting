import type { ReactNode } from 'react'
import type { PageSize } from '../../../state/libraryPrefs'
import { Pager } from './Pager'
import { ViewControls } from './ViewControls'
import { useLibraryPrefs } from './useLibraryPrefs'

export interface PagingInfo { page: number; offset: number; count: number; total: number; hasNext: boolean; loading: boolean; onPage(p: number): void }

interface Props {
  searchLabel: string
  search: string
  onSearch(v: string): void
  /** Filter selects shown after the search box. */
  filters: ReactNode
  /** One entry per active filter, e.g. "Type: T-Shirts". */
  active: string[]
  onClear(): void
  error: string | null
  noun: string
  results: ReactNode
  paging: PagingInfo
  selectedCount: number
  adding?: boolean
  onAdd(): void
}

/** Toolbar, active-filter summary, results, pager and the "Add N to sheet" footer shared by every tab. */
export function BrowserLayout(p: Props) {
  const [prefs, update] = useLibraryPrefs()
  const empty = !p.paging.loading && !p.error && p.paging.count === 0
  return (
    <div className="lib-browser-panel">
      <div className="lib-browser-toolbar">
        <input
          type="search"
          autoFocus
          placeholder={p.searchLabel}
          aria-label={p.searchLabel}
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown') return
            e.preventDefault()
            e.currentTarget.closest('.lib-browser-panel')?.querySelector<HTMLElement>('[data-nav]')?.focus()
          }}
        />
        {p.filters}
        <button type="button" onClick={p.onClear} disabled={p.active.length === 0}>
          Clear filters
        </button>
        <span className="spacer" />
        <ViewControls
          view={prefs.view}
          thumbSize={prefs.thumbSize}
          onView={(view) => update({ view })}
          onThumbSize={(thumbSize) => update({ thumbSize })}
        />
      </div>
      <p className="lib-filter-summary muted" aria-live="polite">
        {p.active.length > 0 ? `Filtered by ${p.active.join(' · ')}` : `All ${p.noun}, newest first`}
      </p>
      {p.error && (
        <p className="inline-error" role="alert">
          {p.error}
        </p>
      )}
      <div className="lib-browser-results">
        {empty ? (
          <div className="lib-empty">
            {p.active.length > 0 ? (
              <>
                <p>No {p.noun} match these filters.</p>
                <button type="button" onClick={p.onClear}>
                  Clear filters
                </button>
              </>
            ) : (
              <p>No {p.noun} yet.</p>
            )}
          </div>
        ) : (
          p.results
        )}
      </div>
      <Pager {...p.paging} pageSize={prefs.pageSize} onPageSize={(pageSize: PageSize) => update({ pageSize })} />
      <div className="lib-browser-footer">
        <span>{p.selectedCount > 0 ? `${p.selectedCount} selected` : 'Nothing selected'}</span>
        <span className="spacer" />
        <button type="button" className="primary" disabled={p.selectedCount === 0 || p.adding} onClick={p.onAdd}>
          {p.adding ? 'Adding…' : `Add ${p.selectedCount} to sheet`}
        </button>
      </div>
    </div>
  )
}
