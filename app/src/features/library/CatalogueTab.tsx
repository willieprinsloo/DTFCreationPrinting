import { useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import type { Customer, GalleryDesign } from '../../api/types'
import { AddDesignDialog } from './AddDesignDialog'
import { CustomerPicker } from './CustomerPicker'
import { Thumb } from './Thumb'
import { typeLabel } from './format'
import { beginLibraryDrag } from './dragAdd'
import { useDesignsQuery } from './queries/useDesignsQuery'
import { useLookup } from './queries/useLookup'
import { useDebounced } from './useDebounced'
import { useErrorHandler } from './useErrorHandler'
import { useLatest } from './useLatest'

const LIMIT = 50

export function CatalogueTab() {
  const { client } = useDtfClient()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [designType, setDesignType] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [lookupError, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listGalleryCategories, onLookupError)
  // Any filter change reloads from page 1. Already loaded thumbnails stay if the request fails.
  const query = useDesignsQuery({ search: debounced, owner: customer?.id, designType, categoryId, limit: LIMIT })
  const [selected, setSelected] = useState<string[]>([])
  const [queue, setQueue] = useState<GalleryDesign[]>([])
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
        <input type="search" placeholder="Search designs" aria-label="Search designs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <CustomerPicker value={customer} onChange={setCustomer} onError={onLookupError} />
        <select aria-label="Type" value={designType} onChange={(e) => setDesignType(e.target.value)}>
          <option value="">All types</option>
          {query.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
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
            src={client.absoluteUrl(d.thumbnailUrl ?? d.imageUrl)}
            label={d.name}
            type={typeLabel(d.designType)}
            selected={selected.includes(d.id)}
            onToggle={() => toggle(d.id)}
            onPointerDown={(e) => {
              const ids = latest.current.selected.includes(d.id) ? latest.current.selected : [d.id]
              beginLibraryDrag(e, d.name, () => enqueue(ids))
            }}
          />
        ))}
        {!query.loading && !error && query.items.length === 0 && <p className="muted">No designs found</p>}
        {query.loading && <p className="muted">Loading…</p>}
      </div>
      {queue[0] && <AddDesignDialog key={queue[0].id} design={queue[0]} customerName={customer?.name} onClose={closeDialog} />}
    </div>
  )
}
