import { useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import type { ProductSummary } from '../../api/types'
import { AddProductDialog } from './AddProductDialog'
import { Thumb } from './Thumb'
import { beginLibraryDrag } from './dragAdd'
import { useProductSources } from './queries/useProductSources'
import { useQuickAdd } from './quickAdd'
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
  const sources = useProductSources()
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const quickAdd = useQuickAdd((id) => categories.find((c) => c.id === id)?.name ?? '')
  const latest = useLatest({ items: query.items, selected, hasNoDesign: sources.hasNoDesign, quickAdd })

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) query.loadMore()
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  /** Quick add (1 × default size each), or with `options` one add dialog per product. */
  const add = async (ids: string[], options: boolean) => {
    const all = latest.current.items.filter((d) => ids.includes(d.id))
    const missing = all.filter((d) => latest.current.hasNoDesign(d.id))
    setNotice(missing.length > 0 ? `No design file for ${missing.map((d) => d.name).join(', ')}` : null)
    const picked = all.filter((d) => !missing.includes(d))
    if (picked.length === 0) return
    if (options) return setQueue(picked)
    setAdding(true)
    try {
      const res = await latest.current.quickAdd(picked)
      if (res.error) setNotice((cur) => (cur ? `${cur}. ${res.error}` : res.error))
      const done = new Set(res.addedIds)
      setSelected((cur) => cur.filter((id) => !done.has(id)))
    } finally {
      setAdding(false)
    }
  }
  const closeDialog = () => {
    setQueue((q) => q.slice(1))
    setSelected((cur) => cur.filter((id) => id !== queue[0]?.id))
  }

  const error = query.error ?? lookupError ?? notice
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
        <button type="button" disabled={selected.length === 0} onClick={() => void add(selected, true)}>
          Add with options…
        </button>
        <button
          type="button"
          className="primary"
          title="Shift-click to choose sizes and widths"
          disabled={selected.length === 0 || adding}
          onClick={(e) => void add(selected, e.shiftKey)}
        >
          Add
        </button>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="thumb-strip" onScroll={onScroll}>
        {query.items.map((d) => (
          <Thumb
            key={d.id}
            src={sources.designSrc(d)}
            badge={sources.hasNoDesign(d.id) ? 'No design file' : undefined}
            onVisible={() => sources.prefetch(d.id)}
            label={d.name}
            selected={selected.includes(d.id)}
            onToggle={() => toggle(d.id)}
            onPointerDown={(e) => {
              const ids = latest.current.selected.includes(d.id) ? latest.current.selected : [d.id]
              const options = e.shiftKey
              beginLibraryDrag(e, d.name, () => add(ids, options))
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
