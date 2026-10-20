import { useCallback, useEffect, useRef, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { ProductCategory, ProductSummary } from '../../api/types'
import { AddProductDialog } from './AddProductDialog'
import { Thumb } from './Thumb'
import { beginLibraryDrag } from './dragAdd'
import { useDebounced } from './useDebounced'

const LIMIT = 50

export function ProductsTab() {
  const { client, requireLogin } = useDtfClient()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [items, setItems] = useState<ProductSummary[]>([])
  const [page, setPage] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [queue, setQueue] = useState<ProductSummary[]>([])
  const generation = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(e instanceof Error ? e.message : String(e))
    },
    [requireLogin],
  )

  useEffect(() => {
    client.listProductCategories().then(setCategories).catch(fail)
  }, [client, fail])

  const loadPage = useCallback(
    async (p: number, reset: boolean) => {
      const gen = ++generation.current
      setLoading(true)
      setError(null)
      try {
        const res = await client.listProducts({ page: p, limit: LIMIT, search: debounced || undefined, categoryId: categoryId || undefined })
        if (gen !== generation.current) return
        setItems((cur) => (reset ? res.items : [...cur, ...res.items.filter((r) => !cur.some((c) => c.id === r.id))]))
        setPage(p)
        setHasNext(res.hasNext)
      } catch (e) {
        if (gen === generation.current) fail(e)
      } finally {
        if (gen === generation.current) setLoading(false)
      }
    },
    [client, debounced, categoryId, fail],
  )

  useEffect(() => {
    void loadPage(1, true)
  }, [loadPage])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (hasNext && !loading && el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) void loadPage(page + 1, false)
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const enqueue = (ids: string[]) => {
    const picked = itemsRef.current.filter((d) => ids.includes(d.id))
    if (picked.length > 0) setQueue(picked)
  }
  const closeDialog = () => {
    setQueue((q) => q.slice(1))
    setSelected((cur) => cur.filter((id) => id !== queue[0]?.id))
  }

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
        {items.map((d) => (
          <Thumb
            key={d.id}
            src={d.thumbnailUrl ? client.absoluteUrl(d.thumbnailUrl) : ''}
            label={d.name}
            selected={selected.includes(d.id)}
            onToggle={() => toggle(d.id)}
            onPointerDown={(e) => {
              const ids = selectedRef.current.includes(d.id) ? selectedRef.current : [d.id]
              beginLibraryDrag(e, d.name, () => enqueue(ids))
            }}
          />
        ))}
        {!loading && !error && items.length === 0 && <p className="muted">No products found</p>}
        {loading && <p className="muted">Loading…</p>}
      </div>
      {queue[0] && <AddProductDialog key={queue[0].id} product={queue[0]} onClose={closeDialog} />}
    </div>
  )
}
