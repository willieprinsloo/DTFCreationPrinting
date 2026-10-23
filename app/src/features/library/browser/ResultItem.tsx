import { useRef, type ReactNode } from 'react'
import type { LibraryView } from '../../../state/libraryPrefs'
import { useOnVisible } from '../useOnVisible'
import { Check } from './Check'
import { thumbSrc } from '../../../platform/tauri'

export interface ResultRow {
  key: string
  label: string
  thumb?: string
  /** Small note over the thumbnail, e.g. "No design file". */
  badge?: string
  /** List-view cells after the checkbox and thumbnail columns. */
  cells: ReactNode[]
  /** Grid-view caption under the thumbnail. */
  caption?: ReactNode
  /** Grid view: what it is, e.g. "T-Shirt", under the caption. */
  type?: string
  checked: boolean | 'mixed'
  expand?: { expanded: boolean; label: string; onToggle(): void }
  sub?: ResultRow[]
  onVisible?(): void
}

interface Props {
  row: ResultRow
  view: LibraryView
  isSub?: boolean
  onToggle(key: string): void
}

const noop = () => {}

/** One focusable row (list) or card (grid); ↑/↓, Space and Enter are handled by ResultsView. */
export function ResultItem({ row, view, isSub, onToggle }: Props) {
  const ref = useRef<HTMLElement>(null)
  useOnVisible(ref, row.onVisible ?? noop)
  const expandBtn = row.expand && (
    <button
      type="button"
      className="icon-btn lib-expand"
      tabIndex={-1}
      aria-expanded={row.expand.expanded}
      aria-label={row.expand.label}
      onClick={(e) => {
        e.stopPropagation()
        row.expand!.onToggle()
      }}
    >
      {row.expand.expanded ? '▾' : '▸'}
    </button>
  )
  const thumb = <span className="lib-thumb">
      {row.thumb && <img src={thumbSrc(row.thumb)} alt="" loading="lazy" draggable={false} />}
      {row.badge && <span className="lib-thumb-badge">{row.badge}</span>}
    </span>
  const common = {
    'data-nav': '',
    'data-key': row.key,
    tabIndex: 0,
    onClick: () => onToggle(row.key),
  }
  if (view === 'list') {
    return (
      <tr ref={ref as React.RefObject<HTMLTableRowElement>} {...common} className={`lib-row${isSub ? ' sub' : ''}`} aria-selected={row.checked === true}>
        <td>
          <Check checked={row.checked} label={`Select ${row.label}`} onChange={() => onToggle(row.key)} tabIndex={-1} />
        </td>
        <td className="lib-thumb-cell">
          {expandBtn}
          {thumb}
        </td>
        {row.cells.map((c, i) => (
          <td key={i}>{c}</td>
        ))}
      </tr>
    )
  }
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      {...common}
      role="checkbox"
      aria-checked={row.checked}
      aria-label={row.label}
      className={`lib-card${row.checked === true ? ' selected' : ''}${isSub ? ' sub' : ''}`}
    >
      {thumb}
      <span className="lib-card-caption">{row.caption ?? row.label}</span>
      {row.type && <span className="thumb-type">{row.type}</span>}
      {expandBtn}
    </div>
  )
}
