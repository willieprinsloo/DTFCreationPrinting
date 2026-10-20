import { useCallback, useEffect, useRef, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { OrderFile, OrderSummary } from '../../api/types'
import { cacheAsset } from '../../platform/tauri'
import { getSheetStore, type NewItem } from '../../state/sheetStore'
import { Thumb } from './Thumb'
import { beginLibraryDrag, endLibraryDrag } from './dragAdd'
import { useDebounced } from './useDebounced'

export function GangSheetsTab() {
  const { client, requireLogin } = useDtfClient()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [inProduction, setInProduction] = useState(false)
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [page, setPage] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, OrderFile[]>>({})
  const [selected, setSelected] = useState<string[]>([])
  const generation = useRef(0)
  const stateRef = useRef({ orders, files, selected })
  stateRef.current = { orders, files, selected }

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(e instanceof Error ? e.message : String(e))
    },
    [requireLogin],
  )

  const loadPage = useCallback(
    async (p: number, reset: boolean) => {
      const gen = ++generation.current
      setLoading(true)
      setError(null)
      try {
        const statuses = inProduction ? ['confirmed', 'in_production'] : ['confirmed']
        const results = await Promise.all(statuses.map((status) => client.listOrders({ status, search: debounced || undefined, page: p })))
        if (gen !== generation.current) return
        const fresh = results.flatMap((r) => r.items)
        setOrders((cur) => {
          const base = reset ? [] : cur
          return [...base, ...fresh.filter((o) => !base.some((b) => b.id === o.id))]
        })
        setPage(p)
        setHasNext(results.some((r) => r.hasNext))
      } catch (e) {
        if (gen === generation.current) fail(e)
      } finally {
        if (gen === generation.current) setLoading(false)
      }
    },
    [client, debounced, inProduction, fail],
  )

  useEffect(() => {
    void loadPage(1, true)
  }, [loadPage])

  const expand = async (order: OrderSummary) => {
    if (expanded === order.id) {
      setExpanded(null)
      return
    }
    setExpanded(order.id)
    if (files[order.id]) return
    try {
      const list = await client.getOrderFiles(order.id)
      setFiles((cur) => ({ ...cur, [order.id]: list }))
    } catch (e) {
      fail(e)
    }
  }

  const keyOf = (orderId: string, f: OrderFile) => `${orderId}:${f.itemId}`

  const addSelected = async (keys: string[]) => {
    const { orders: os, files: fs } = stateRef.current
    const items: NewItem[] = []
    setError(null)
    for (const o of os) {
      for (const f of fs[o.id] ?? []) {
        if (!keys.includes(keyOf(o.id, f))) continue
        try {
          const asset = await cacheAsset(client.absoluteUrl(f.printFileUrl), client.token() ?? undefined)
          items.push({
            asset,
            source: {
              kind: 'order-file',
              id: f.itemId,
              label: `${o.orderNumber} ${f.sizeLabel}`,
              orderId: o.id,
              orderNumber: o.orderNumber,
              customerName: o.customerName,
            },
            widthMm: (asset.widthPx / 300) * 25.4,
            heightMm: (asset.heightPx / 300) * 25.4,
            quantity: 1,
          })
        } catch (e) {
          if (e instanceof AuthRequiredError) requireLogin()
          setError(`Couldn't download ${o.orderNumber} ${f.sizeLabel} — try again`)
        }
      }
    }
    if (items.length > 0) {
      getSheetStore().getState().addItems(items)
      setSelected((cur) => cur.filter((k) => !keys.includes(k)))
    }
  }

  const toggle = (k: string) => setSelected((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (hasNext && !loading && el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) void loadPage(page + 1, false)
  }

  return (
    <div className="library-tab">
      <div className="library-toolbar">
        <input type="search" placeholder="Search orders" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="dialog-check">
          <input type="checkbox" checked={inProduction} onChange={(e) => setInProduction(e.target.checked)} /> Include in production
        </label>
        <span className="spacer" />
        <button type="button" className="primary" disabled={selected.length === 0} onClick={() => void addSelected(selected)}>
          Add
        </button>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="thumb-strip" onScroll={onScroll}>
        {orders.map((o) => (
          <div className="order-group" key={o.id}>
            <button type="button" className="order-card" aria-expanded={expanded === o.id} onClick={() => void expand(o)}>
              <strong>{o.orderNumber}</strong>
              <span className="muted">{o.customerName}</span>
              <span className="muted">{o.status}</span>
            </button>
            {expanded === o.id &&
              (files[o.id] ?? []).map((f) => {
                const k = keyOf(o.id, f)
                return (
                  <Thumb
                    key={k}
                    src={client.absoluteUrl(f.printFileUrl)}
                    label={`${o.orderNumber} ${f.sizeLabel}`}
                    caption={f.sizeLabel}
                    selected={selected.includes(k)}
                    onToggle={() => toggle(k)}
                    onDragStart={(e) => {
                      const keys = selected.includes(k) ? selected : [k]
                      if (!selected.includes(k)) setSelected([k])
                      beginLibraryDrag(e, () => void addSelected(keys))
                    }}
                    onDragEnd={endLibraryDrag}
                  />
                )
              })}
          </div>
        ))}
        {!loading && !error && orders.length === 0 && <p className="muted">No orders found</p>}
        {loading && <p className="muted">Loading…</p>}
      </div>
    </div>
  )
}
