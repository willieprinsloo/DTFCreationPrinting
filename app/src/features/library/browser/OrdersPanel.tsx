import { useState } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { OrderSummary } from '../../../api/types'
import { DEFAULT_ORDER_PREFS, type OrderDateFilter, type OrderPrefs, type OrderSort, type OrderStatusFilter } from '../../../state/libraryPrefs'
import { getSheetStore } from '../../../state/sheetStore'
import { getViewportStore } from '../../canvas/useViewport'
import { fileCount, fileTypes, formatDate, statusLabel, typeLabel } from '../format'
import { downloadOrderFiles, orderFileKey, type OrderFileRef } from '../orderFileItems'
import { useOrderDetails } from '../queries/useOrderDetails'
import { MAX_ORDER_LIMIT, useOrdersQuery } from '../queries/useOrdersQuery'
import { useDebounced } from '../useDebounced'
import { useErrorHandler } from '../useErrorHandler'
import { BrowserLayout } from './BrowserLayout'
import { ResultsView, type ResultColumn } from './ResultsView'
import type { ResultRow } from './ResultItem'
import { dateFromFor, sortItems } from './sorting'
import { useLibraryPrefs } from './useLibraryPrefs'
import { useSelection } from './useSelection'

const STATUSES: Record<OrderStatusFilter, { label: string; values: string[] }> = {
  confirmed: { label: 'Confirmed', values: ['confirmed'] },
  in_production: { label: 'In production', values: ['in_production'] },
  both: { label: 'Confirmed + in production', values: ['confirmed', 'in_production'] },
}
const DATES: Array<[OrderDateFilter, string]> = [['all', 'Any date'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']]
const SORTS: Array<[OrderSort, string]> = [['newest', 'Newest'], ['oldest', 'Oldest'], ['number', 'Order no.'], ['customer', 'Customer']]
const COLUMNS: ResultColumn<OrderSort>[] = [
  { label: 'Order no.', sort: 'number' },
  { label: 'Customer', sort: 'customer' },
  { label: 'Date', sort: ['newest', 'oldest'] },
  { label: 'Status' },
  { label: 'Files' },
]

export function OrdersPanel({ onAdded }: { onAdded(): void }) {
  const { client, requireLogin } = useDtfClient()
  const [prefs, update] = useLibraryPrefs()
  const f = prefs.orders
  const setF = (patch: Partial<OrderPrefs>) => update({ orders: patch })
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const statuses = STATUSES[f.status].values
  const query = useOrdersQuery({ search: debounced, statuses, dateFrom: dateFromFor(f.date), limit: prefs.pageSize })
  const details = useOrderDetails()
  const selection = useSelection<OrderFileRef>()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [error, fail, setError] = useErrorHandler()
  const [adding, setAdding] = useState(false)

  const refsOf = (o: OrderSummary, files = details.files[o.id] ?? []): Array<[string, OrderFileRef]> =>
    files.map((file) => {
      const key = orderFileKey(o.id, file)
      return [key, { order: o, file, customerName: details.customerName(o), key }]
    })

  const filesFor = async (o: OrderSummary) => {
    try {
      return details.files[o.id] ?? (await details.loadFiles(o.id))
    } catch (e) {
      fail(e)
      return []
    }
  }

  /** Ticking an order ticks all of its files (loading them first if needed). */
  const toggleOrder = async (o: OrderSummary) => {
    // Decided inside the state update, so clicks made while the files loaded are taken into account.
    selection.toggleAll(refsOf(o, await filesFor(o)))
  }
  const selectPage = async (on: boolean) => {
    if (!on) {
      // Deselecting needs no file lists: drop every selected file that belongs to this page's orders.
      const ids = new Set(query.items.map((o) => o.id))
      selection.remove([...selection.map.entries()].filter(([, r]) => ids.has(r.order.id)).map(([k]) => k))
      return
    }
    const lists = await Promise.all(query.items.map(async (o) => refsOf(o, await filesFor(o))))
    selection.setMany(lists.flat(), on)
  }
  const onToggle = (key: string) => {
    const o = query.items.find((x) => x.id === key)
    if (o) return void toggleOrder(o)
    const ref = query.items.flatMap((x) => refsOf(x)).find(([k]) => k === key)
    if (ref) selection.toggle(key, ref[1])
  }
  const toggleExpanded = (o: OrderSummary) => {
    const open = !expanded.has(o.id)
    setExpanded((cur) => {
      const next = new Set(cur)
      if (open) next.add(o.id)
      else next.delete(o.id)
      return next
    })
    if (open) void filesFor(o)
  }

  const sorted = sortItems(
    query.items,
    f.sort === 'number' ? (o) => o.orderNumber : f.sort === 'customer' ? details.customerName : f.sort,
    (o) => o.createdAt,
  )
  const rows: ResultRow[] = sorted.map((o) => {
    const files = details.files[o.id]
    const keys = (files ?? []).map((file) => orderFileKey(o.id, file))
    const picked = keys.filter((k) => selection.has(k)).length
    const name = details.customerName(o) || 'Unknown customer'
    return {
      key: o.id,
      label: `${o.orderNumber} ${name}`,
      thumb: files?.[0] ? client.absoluteUrl(files[0].printFileUrl) : undefined,
      caption: (
        <>
          <strong>{o.orderNumber}</strong> {name}
        </>
      ),
      checked: keys.length > 0 && picked === keys.length ? true : picked > 0 ? 'mixed' : false,
      type: files ? fileTypes(files) : undefined,
      cells: [o.orderNumber, name, formatDate(o.createdAt), statusLabel(o.status), files ? fileCount(files.length) : '…'],
      expand: { expanded: expanded.has(o.id), label: `Files of ${o.orderNumber}`, onToggle: () => toggleExpanded(o) },
      onVisible: () => details.prefetch(o),
      sub: expanded.has(o.id)
        ? (files ?? []).map((file) => {
            const key = orderFileKey(o.id, file)
            return {
              key,
              label: `${o.orderNumber} ${file.sizeLabel}`,
              thumb: client.absoluteUrl(file.printFileUrl),
              caption: file.sizeLabel,
              type: typeLabel(file.productType),
              checked: selection.has(key),
              cells: [file.sizeLabel, '', '', file.productType, ''],
            }
          })
        : undefined,
    }
  })

  const active = [
    debounced && `Search "${debounced}"`,
    f.status !== DEFAULT_ORDER_PREFS.status && `Status: ${STATUSES[f.status].label}`,
    f.date !== DEFAULT_ORDER_PREFS.date && `Date: ${DATES.find(([v]) => v === f.date)?.[1]}`,
  ].filter((x): x is string => !!x)

  const add = async () => {
    if (adding || selection.size === 0) return
    setAdding(true)
    setError(null)
    const res = await downloadOrderFiles(client, [...selection.map.values()])
    setAdding(false)
    if (res.authFailed) requireLogin()
    if (res.items.length > 0) {
      getSheetStore().getState().addItems(res.items)
      selection.remove(res.done)
    }
    if (res.error) {
      setError(res.error)
      if (res.items.length > 0) getViewportStore().getState().autoView()
    } else if (res.items.length > 0) onAdded()
  }

  const perRequest = Math.min(prefs.pageSize, MAX_ORDER_LIMIT)
  return (
    <BrowserLayout
      searchLabel="Search orders"
      searchPlaceholder="Order no. or delivery name"
      search={search}
      onSearch={setSearch}
      noun="orders"
      filters={
        <>
          <select aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value as OrderStatusFilter })}>
            {Object.entries(STATUSES).map(([v, s]) => (
              <option key={v} value={v}>
                {s.label}
              </option>
            ))}
          </select>
          <select aria-label="Date" value={f.date} onChange={(e) => setF({ date: e.target.value as OrderDateFilter })}>
            {DATES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Sort" value={f.sort} onChange={(e) => setF({ sort: e.target.value as OrderSort })}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      }
      active={active}
      onClear={() => {
        setSearch('')
        setF({ status: DEFAULT_ORDER_PREFS.status, date: DEFAULT_ORDER_PREFS.date })
      }}
      error={error ?? query.error}
      results={
        <ResultsView
          rows={rows}
          columns={COLUMNS}
          view={prefs.view}
          thumbSize={prefs.thumbSize}
          sort={f.sort}
          onSort={(sort) => setF({ sort })}
          onToggle={onToggle}
          onSelectPage={(on) => void selectPage(on)}
          onAdd={() => void add()}
        />
      }
      paging={{
        page: query.page,
        offset: (query.page - 1) * perRequest * statuses.length,
        count: query.items.length,
        total: query.total,
        hasNext: query.hasNext,
        loading: query.loading,
        onPage: query.goTo,
      }}
      selectedCount={selection.size}
      hiddenCount={[...selection.map.values()].filter((r) => !query.items.some((o) => o.id === r.order.id)).length}
      adding={adding}
      onAdd={() => void add()}
    />
  )
}
