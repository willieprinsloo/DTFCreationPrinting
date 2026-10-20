import { LayoutGrid, List } from 'lucide-react'
import type { LibraryView, ThumbSize } from '../../../state/libraryPrefs'

interface Props {
  view: LibraryView
  thumbSize: ThumbSize
  onView(v: LibraryView): void
  onThumbSize(s: ThumbSize): void
}

export function ViewControls({ view, thumbSize, onView, onThumbSize }: Props) {
  return (
    <div className="lib-view-controls">
      <div className="seg" role="group" aria-label="View">
        <button type="button" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => onView('grid')}>
          <LayoutGrid size={14} />
        </button>
        <button type="button" aria-pressed={view === 'list'} aria-label="List view" onClick={() => onView('list')}>
          <List size={14} />
        </button>
      </div>
      <div className="seg" role="group" aria-label="Thumbnail size">
        {(['S', 'M', 'L'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={thumbSize === s} onClick={() => onThumbSize(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
