import { useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import type { ProductSummary } from '../../api/types'
import { AddProductDialog } from './AddProductDialog'
import { Thumb } from './Thumb'
import { beginLibraryDrag } from './dragAdd'
import { useLookup } from './queries/useLookup'
import { useProductsQuery } from './queries/useProductsQuery'
import { useDebounced } from './useDebounced'
import { useErrorHandler } from './useErrorHandler'
import { useLatest } from './useLatest'

const LIMIT = 50

export function ProductsTab() {
  const { client } = useDtfClient()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [categoryId, setCategoryId] = useState('')
  const [lookupError, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listProductCategories, onLookupError)
  const query = useProductsQuery({ search: debounced, categoryId, limit: LIMIT })
  const [selected, setSelected] = useState<string[]>([])
  const [queue, setQueue] = useState<ProductSummary[]>([])
  const latest = useLatest({ items: query.items, selected })

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) query.loadMore()
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const enqueue = (ids: string[]) => {
    const picked = latest.current.items.filter((d) => ids.includes(d.id))
    if (picked.length > 0) setQueue(picked)
  }
  const closeDialog = () => {
    setQueue((q) => q.slice(1))
    setSelected((cur) => cur.filter((id) => id !== queue[0]?.id))
  }

  const error = query.error ?? lookupError
  return (
    <div className="library-tab">
      <div className="library-toolbar">
        <input type="search" placeholder="Search products" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Type" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All types</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button type="button" className="primary" disabled={selected.length === 0} onClick={() => enqueue(selected)}>
          Add
        </button>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="thumb-strip" onScroll={onScroll}>
        {query.items.map((d) => (
          <Thumb
            key={d.id}
            src={d.thumbnailUrl ? client.absoluteUrl(d.thumbnailUrl) : ''}
            label={d.name}
            selected={selected.includes(d.id)}
            onToggle={() => toggle(d.id)}
            onPointerDown={(e) => {
              const ids = latest.current.selected.includes(d.id) ? latest.current.selected : [d.id]
              beginLibraryDrag(e, d.name, () => enqueue(ids))
            }}
          />
        ))}
        {!query.loading && !error && query.items.length === 0 && <p className="muted">No products found</p>}
        {query.loading && <p className="muted">Loading…</p>}
      </div>
      {queue[0] && <AddProductDialog key={queue[0].id} product={queue[0]} onClose={closeDialog} />}
    </div>
  )
}
