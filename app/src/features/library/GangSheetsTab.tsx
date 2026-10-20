import { useRef, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'
import type { OrderFile, OrderSummary } from '../../api/types'
import { getSheetStore } from '../../state/sheetStore'
import { OrderCard } from './OrderCard'
import { Thumb } from './Thumb'
import { beginLibraryDrag } from './dragAdd'
import { fileCount } from './format'
import { downloadOrderFiles, orderFileKey, type OrderFileRef } from './orderFileItems'
import { useOrderDetails } from './queries/useOrderDetails'
import { useOrdersQuery } from './queries/useOrdersQuery'
import { useDebounced } from './useDebounced'
import { useLatest } from './useLatest'

export function GangSheetsTab() {
  const { client, requireLogin } = useDtfClient()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [inProduction, setInProduction] = useState(false)
  const query = useOrdersQuery({ search: debounced, statuses: inProduction ? ['confirmed', 'in_production'] : ['confirmed'] })
  const details = useOrderDetails()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const justDragged = useRef(false)
  const latest = useLatest({ orders: query.items, details, selected })

  const expand = async (order: OrderSummary) => {
    if (expanded === order.id) {
      setExpanded(null)
      return
    }
    setExpanded(order.id)
    if (details.files[order.id]) return
    try {
      await details.loadFiles(order.id)
    } catch (e) {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const addRefs = async (refs: OrderFileRef[]) => {
    setError(null)
    setNotice(null)
    const res = await downloadOrderFiles(client, refs)
    if (res.authFailed) requireLogin()
    if (res.error) setError(res.error)
    if (res.items.length > 0) {
      getSheetStore().getState().addItems(res.items)
      setSelected((cur) => cur.filter((k) => !res.done.includes(k)))
    }
  }

  const addSelected = async (keys: string[]) => {
    const { orders, details: d } = latest.current
    await addRefs(
      orders.flatMap((o) =>
        (d.files[o.id] ?? [])
          .map((file) => ({ order: o, file, customerName: d.customerName(o), key: orderFileKey(o.id, file) }))
          .filter((r) => keys.includes(r.key)),
      ),
    )
  }

  /** Adds the ticked files of an order, or all of its files when none are ticked (loading them if needed). */
  const addOrder = async (order: OrderSummary) => {
    setError(null)
    setNotice(null)
    let files: OrderFile[]
    try {
      files = await details.loadFiles(order.id)
    } catch (e) {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    if (files.length === 0) {
      setNotice(`Order ${order.orderNumber} has no print files yet`)
      return
    }
    const ticked = files.filter((f) => latest.current.selected.includes(orderFileKey(order.id, f)))
    const chosen = ticked.length > 0 ? ticked : files
    const customerName = latest.current.details.customerName(order)
    await addRefs(chosen.map((file) => ({ order, file, customerName, key: orderFileKey(order.id, file) })))
  }

  const toggle = (k: string) => setSelected((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) query.loadMore()
  }

  const shownError = error ?? query.error
  return (
    <div className="library-tab">
      <div className="library-toolbar">
        <input type="search" placeholder="Order no. or delivery name" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="dialog-check">
          <input type="checkbox" checked={inProduction} onChange={(e) => setInProduction(e.target.checked)} /> Include in production
        </label>
        <span className="spacer" />
        <button type="button" className="primary" disabled={selected.length === 0} onClick={() => void addSelected(selected)}>
          Add
        </button>
      </div>
      {shownError && <p className="inline-error">{shownError}</p>}
      {notice && !shownError && <p className="muted" role="status">{notice}</p>}
      <div className="thumb-strip" onScroll={onScroll}>
        {query.items.map((o) => {
          const files = details.files[o.id]
          return (
            <div className="order-group" key={o.id}>
              <OrderCard
                order={o}
                name={details.customerName(o)}
                files={files}
                thumbSrc={files?.[0] ? client.absoluteUrl(files[0].printFileUrl) : undefined}
                expanded={expanded === o.id}
                onVisible={() => details.prefetch(o)}
                onClick={() => {
                  if (justDragged.current) return
                  void expand(o)
                }}
                onDoubleClick={() => void addOrder(o)}
                onPointerDown={(e) =>
                  beginLibraryDrag(
                    e,
                    `${o.orderNumber} · ${files ? fileCount(files.length) : 'files'}`,
                    () => addOrder(o),
                    (dragged) => {
                      if (!dragged) return
                      justDragged.current = true
                      setTimeout(() => (justDragged.current = false), 0)
                    },
                  )
                }
              />
              {expanded === o.id &&
                (files ?? []).map((f) => {
                  const k = orderFileKey(o.id, f)
                  return (
                    <Thumb
                      key={k}
                      src={client.absoluteUrl(f.printFileUrl)}
                      label={`${o.orderNumber} ${f.sizeLabel}`}
                      caption={f.sizeLabel}
                      selected={selected.includes(k)}
                      onToggle={() => toggle(k)}
                      onPointerDown={(e) => {
                        const keys = latest.current.selected.includes(k) ? latest.current.selected : [k]
                        beginLibraryDrag(e, `${o.orderNumber} ${f.sizeLabel}`, () => addSelected(keys))
                      }}
                    />
                  )
                })}
            </div>
          )
        })}
        {!query.loading && !shownError && query.items.length === 0 && <p className="muted">No orders found</p>}
        {query.loading && <p className="muted">Loading…</p>}
      </div>
    </div>
  )
}
