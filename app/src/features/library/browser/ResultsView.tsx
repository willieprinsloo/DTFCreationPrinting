import { Fragment, useRef } from 'react'
import type { LibraryView, ThumbSize } from '../../../state/libraryPrefs'
import { Check } from './Check'
import { ResultItem, type ResultRow } from './ResultItem'

export interface ResultColumn<S extends string> {
  label: string
  /** Sort applied when the header is clicked; a pair toggles between the two (e.g. newest/oldest). */
  sort?: S | readonly [S, S]
}

interface Props<S extends string> {
  rows: ResultRow[]
  columns: ResultColumn<S>[]
  view: LibraryView
  thumbSize: ThumbSize
  sort: S
  onSort(s: S): void
  onToggle(key: string): void
  onSelectPage(on: boolean): void
  onAdd(): void
}

const isMod = (e: React.KeyboardEvent) => e.metaKey || e.ctrlKey

export function ResultsView<S extends string>({ rows, columns, view, thumbSize, sort, onSort, onToggle, onSelectPage, onAdd }: Props<S>) {
  const box = useRef<HTMLDivElement>(null)
  const all = rows.length > 0 && rows.every((r) => r.checked === true)
  const some = rows.some((r) => r.checked !== false)
  const pageCheck = <Check checked={all ? true : some ? 'mixed' : false} label="Select all on page" onChange={() => onSelectPage(!all)} />

  const onKeyDown = (e: React.KeyboardEvent) => {
    const navs = [...(box.current?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])]
    const i = navs.indexOf(document.activeElement as HTMLElement)
    const target = e.target as HTMLElement
    const step = e.key === 'ArrowDown' || (view === 'grid' && e.key === 'ArrowRight') ? 1 : e.key === 'ArrowUp' || (view === 'grid' && e.key === 'ArrowLeft') ? -1 : 0
    if (step !== 0) {
      e.preventDefault()
      navs[Math.min(navs.length - 1, Math.max(0, i + step))]?.focus()
    } else if (e.key === ' ' && target.dataset.key !== undefined) {
      e.preventDefault()
      onToggle(target.dataset.key)
    } else if (e.key === 'Enter' && target.dataset.key !== undefined) {
      e.preventDefault()
      onAdd()
    } else if (isMod(e) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelectPage(true)
    }
  }

  const sortOf = (c: ResultColumn<S>) => (Array.isArray(c.sort) ? c.sort : c.sort ? [c.sort] : [])
  const headerClick = (c: ResultColumn<S>) => {
    const opts = sortOf(c) as S[]
    if (opts.length === 0) return
    onSort(opts[0] === sort && opts[1] ? opts[1] : opts[0])
  }

  const renderRows = (r: ResultRow) => (
    <Fragment key={r.key}>
      <ResultItem row={r} view={view} onToggle={onToggle} />
      {r.sub?.map((s) => <ResultItem key={s.key} row={s} view={view} isSub onToggle={onToggle} />)}
    </Fragment>
  )

  return (
    <div ref={box} className={`lib-results size-${thumbSize}`} onKeyDown={onKeyDown}>
      {view === 'list' ? (
        <table className="lib-table">
          <thead>
            <tr>
              <th className="lib-check-col">{pageCheck}</th>
              <th className="lib-thumb-col" aria-label="Thumbnail" />
              {columns.map((c) => {
                const opts = sortOf(c) as S[]
                const active = opts.includes(sort)
                return (
                  <th key={c.label} aria-sort={active ? (opts.length === 2 && sort === opts[0] ? 'descending' : 'ascending') : undefined}>
                    {opts.length > 0 ? (
                      <button type="button" className={`lib-sort${active ? ' active' : ''}`} onClick={() => headerClick(c)}>
                        {c.label}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>{rows.map(renderRows)}</tbody>
        </table>
      ) : (
        <>
          <label className="lib-select-page">{pageCheck} Select all on page</label>
          <div className="lib-grid">{rows.map(renderRows)}</div>
        </>
      )}
    </div>
  )
}
