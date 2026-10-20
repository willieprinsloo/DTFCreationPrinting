import { useCallback, useEffect, useRef, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { OrderFile, OrderSummary } from '../../api/types'
import { cacheAsset } from '../../platform/tauri'
import { getSheetStore, type NewItem } from '../../state/sheetStore'
import { Thumb } from './Thumb'
import { beginLibraryDrag } from './dragAdd'
import { useDebounced } from './useDebounced'

const MAX_FILE_REQUESTS = 4

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface CardProps {
  order: OrderSummary
  name: string | undefined
  files: OrderFile[] | undefined
  thumbSrc: string | undefined
  expanded: boolean
  onVisible(): void
  onClick(): void
}

function OrderCard({ order, name, files, thumbSrc, expanded, onVisible, onClick }: CardProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const visibleRef = useRef(onVisible)
  visibleRef.current = onVisible
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      visibleRef.current()
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        visibleRef.current()
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const date = formatDate(order.createdAt)
  return (
    <button ref={ref} type="button" className="order-card" aria-expanded={expanded} onClick={onClick}>
      <span className="order-card-thumb">{thumbSrc && <img src={thumbSrc} alt="" loading="lazy" draggable={false} />}</span>
      <strong>{order.orderNumber}</strong>
      <span className="muted">{name || order.customerName || 'Unknown customer'}</span>
      {date && <span className="muted">{date}</span>}
      <span className="muted">{order.status}</span>
      {files && <span className="muted">{files.length === 1 ? '1 file' : `${files.length} files`}</span>}
    </button>
  )
}

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
  const [customers, setCustomers] = useState<Record<string, string>>({})
  const generation = useRef(0)
  const customerReqs = useRef(new Map<string, Promise<void>>())
  const fileReqs = useRef(new Map<string, Promise<OrderFile[]>>())
  const slots = useRef({ active: 0, waiting: [] as Array<() => void> })
  const stateRef = useRef({ orders, files, selected, customers })
  stateRef.current = { orders, files, selected, customers }
  const selectedRef = useRef(selected)
  selectedRef.current = selected

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

  const withSlot = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const s = slots.current
    if (s.active >= MAX_FILE_REQUESTS) await new Promise<void>((r) => s.waiting.push(r))
    else s.active++
    try {
      return await fn()
    } finally {
      const next = s.waiting.shift()
      if (next) next()
      else s.active--
    }
  }

  const loadFiles = (orderId: string): Promise<OrderFile[]> => {
    let p = fileReqs.current.get(orderId)
    if (!p) {
      p = withSlot(() => client.getOrderFiles(orderId)).then((list) => {
        setFiles((cur) => ({ ...cur, [orderId]: list }))
        return list
      })
      p.catch(() => {
        fileReqs.current.delete(orderId)
      })
      fileReqs.current.set(orderId, p)
    }
    return p
  }

  const loadCustomer = (customerId: string | undefined) => {
    if (!customerId || customerReqs.current.has(customerId)) return
    customerReqs.current.set(
      customerId,
      client.getCustomer(customerId).then(
        (c) => {
          if (c.name) setCustomers((cur) => ({ ...cur, [customerId]: c.name }))
        },
        (e) => {
          customerReqs.current.delete(customerId)
          if (e instanceof AuthRequiredError) requireLogin()
        },
      ),
    )
  }

  const onCardVisible = (o: OrderSummary) => {
    loadCustomer(o.customerId)
    loadFiles(o.id).catch((e) => {
      if (e instanceof AuthRequiredError) requireLogin()
    })
  }

  const expand = async (order: OrderSummary) => {
    if (expanded === order.id) {
      setExpanded(null)
      return
    }
    setExpanded(order.id)
    if (files[order.id]) return
    try {
      await loadFiles(order.id)
    } catch (e) {
      fail(e)
    }
  }

  const keyOf = (orderId: string, f: OrderFile) => `${orderId}:${f.itemId}`

  const addSelected = async (keys: string[]) => {
    const { orders: os, files: fs, customers: cs } = stateRef.current
    const items: NewItem[] = []
    const done: string[] = []
    setError(null)
    for (const o of os) {
      for (const f of fs[o.id] ?? []) {
        if (!keys.includes(keyOf(o.id, f))) continue
        try {
          const url = client.absoluteUrl(f.printFileUrl)
          const asset = await cacheAsset(url, client.bearerFor(url))
          done.push(keyOf(o.id, f))
          items.push({
            asset,
            source: {
              kind: 'order-file',
              id: f.itemId,
              label: `${o.orderNumber} ${f.sizeLabel}`,
              orderId: o.id,
              orderNumber: o.orderNumber,
              customerName: (o.customerId && cs[o.customerId]) || o.customerName,
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
      setSelected((cur) => cur.filter((k) => !done.includes(k)))
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
            <OrderCard
              order={o}
              name={o.customerId ? customers[o.customerId] : undefined}
              files={files[o.id]}
              thumbSrc={files[o.id]?.[0] ? client.absoluteUrl(files[o.id][0].printFileUrl) : undefined}
              expanded={expanded === o.id}
              onVisible={() => onCardVisible(o)}
              onClick={() => void expand(o)}
            />
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
                    onPointerDown={(e) => {
                      const keys = selectedRef.current.includes(k) ? selectedRef.current : [k]
                      beginLibraryDrag(e, `${o.orderNumber} ${f.sizeLabel}`, () => void addSelected(keys))
                    }}
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
