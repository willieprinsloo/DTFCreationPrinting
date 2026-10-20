import { useCallback, useEffect, useRef, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { Customer, GalleryCategory, GalleryDesign } from '../../api/types'
import { AddDesignDialog } from './AddDesignDialog'
import { Thumb } from './Thumb'
import { beginLibraryDrag } from './dragAdd'
import { useDebounced } from './useDebounced'

const LIMIT = 50

export function CatalogueTab() {
  const { client, requireLogin } = useDtfClient()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [designType, setDesignType] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<GalleryCategory[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [items, setItems] = useState<GalleryDesign[]>([])
  const [page, setPage] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [queue, setQueue] = useState<GalleryDesign[]>([])
  const [customerOpen, setCustomerOpen] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([])
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
    client.listGalleryCategories().then(setCategories).catch(fail)
  }, [client, fail])

  const debouncedCustomerQuery = useDebounced(customerQuery.trim(), 300)
  useEffect(() => {
    if (!customerOpen) return
    client.listCustomers(debouncedCustomerQuery || undefined).then(setCustomerOptions).catch(fail)
  }, [client, customerOpen, debouncedCustomerQuery, fail])

  const loadPage = useCallback(
    async (p: number, reset: boolean) => {
      const gen = ++generation.current
      setLoading(true)
      setError(null)
      try {
        const res = await client.listGalleryDesigns({
          page: p,
          limit: LIMIT,
          search: debounced || undefined,
          owner: customer?.id,
          designType: designType || undefined,
          categoryId: categoryId || undefined,
        })
        if (gen !== generation.current) return
        setItems((cur) => (reset ? res.items : [...cur, ...res.items.filter((r) => !cur.some((c) => c.id === r.id))]))
        setTypes((cur) => [...new Set([...cur, ...res.items.map((r) => r.designType).filter(Boolean)])].sort())
        setPage(p)
        setHasNext(res.hasNext)
      } catch (e) {
        if (gen === generation.current) fail(e)
      } finally {
        if (gen === generation.current) setLoading(false)
      }
    },
    [client, debounced, customer, designType, categoryId, fail],
  )

  // Any filter change reloads from page 1. Already loaded thumbnails stay if the request fails.
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
        <input type="search" placeholder="Search designs" aria-label="Search designs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="chip-wrap">
          {customer ? (
            <button type="button" className="chip active" onClick={() => setCustomer(null)} aria-label={`Customer: ${customer.name} (clear)`}>
              Customer: {customer.name} ×
            </button>
          ) : (
            <button type="button" className="chip" aria-expanded={customerOpen} onClick={() => setCustomerOpen((o) => !o)}>
              Customer
            </button>
          )}
          {customerOpen && !customer && (
            <div className="chip-menu" role="listbox" aria-label="Customers">
              <input
                type="search"
                placeholder="Find customer"
                aria-label="Find customer"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
              />
              {customerOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setCustomer(c)
                    setCustomerOpen(false)
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <select aria-label="Type" value={designType} onChange={(e) => setDesignType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => (
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
        {items.map((d) => (
          <Thumb
            key={d.id}
            src={client.absoluteUrl(d.thumbnailUrl ?? d.imageUrl)}
            label={d.name}
            selected={selected.includes(d.id)}
            onToggle={() => toggle(d.id)}
            onPointerDown={(e) => {
              const ids = selectedRef.current.includes(d.id) ? selectedRef.current : [d.id]
              beginLibraryDrag(e, d.name, () => enqueue(ids))
            }}
          />
        ))}
        {!loading && !error && items.length === 0 && <p className="muted">No designs found</p>}
        {loading && <p className="muted">Loading…</p>}
      </div>
      {queue[0] && <AddDesignDialog key={queue[0].id} design={queue[0]} customerName={customer?.name} onClose={closeDialog} />}
    </div>
  )
}
