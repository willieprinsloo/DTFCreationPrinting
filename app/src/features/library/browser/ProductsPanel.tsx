import { useRef, useState } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { ProductSummary } from '../../../api/types'
import { DEFAULT_PRODUCT_PREFS, type ProductPrefs, type ProductSort } from '../../../state/libraryPrefs'
import { AddProductDialog } from '../AddProductDialog'
import { getViewportStore } from '../../canvas/useViewport'
import { formatDate } from '../format'
import { useQuickAdd } from '../quickAdd'
import { useLookup } from '../queries/useLookup'
import { useProductSources } from '../queries/useProductSources'
import { useProductsQuery } from '../queries/useProductsQuery'
import { useDebounced } from '../useDebounced'
import { useErrorHandler } from '../useErrorHandler'
import { BrowserLayout } from './BrowserLayout'
import { ResultsView, type ResultColumn } from './ResultsView'
import type { ResultRow } from './ResultItem'
import { sortItems } from './sorting'
import { useDialogQueue } from './useDialogQueue'
import { useLibraryPrefs } from './useLibraryPrefs'
import { useSelection } from './useSelection'

const STATUS_LABELS: Record<ProductPrefs['status'], string> = { '': 'All', draft: 'Draft', active: 'Live', archived: 'Archived' }
const SORTS: Array<[ProductSort, string]> = [['newest', 'Newest'], ['oldest', 'Oldest'], ['name', 'Name A–Z'], ['type', 'Type']]
const COLUMNS: ResultColumn<ProductSort>[] = [
  { label: 'Name', sort: 'name' },
  { label: 'Type', sort: 'type' },
  { label: 'Sizes' },
  { label: 'Created', sort: ['newest', 'oldest'] },
]

export function ProductsPanel({ onAdded }: { onAdded(): void }) {
  const { client } = useDtfClient()
  const [prefs, update] = useLibraryPrefs()
  const f = prefs.products
  const setF = (patch: Partial<ProductPrefs>) => update({ products: patch })
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [lookupError, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listProductCategories, onLookupError)
  const query = useProductsQuery({ search: debounced, categoryId: f.categoryId, status: f.status, limit: prefs.pageSize })
  const selection = useSelection<ProductSummary>()
  const [notice, setNotice] = useState<string | null>(null)
  const noticeRef = useRef(notice)
  noticeRef.current = notice
  const dialogs = useDialogQueue<ProductSummary>(() => {
    // Keep the browser open when some selected products had no design file, so that notice isn't lost.
    if (!noticeRef.current) onAdded()
  })
  const sources = useProductSources()
  const [adding, setAdding] = useState(false)
  const quickAdd = useQuickAdd((id) => categories.find((c) => c.id === id)?.name ?? '')

  const typeName = (p: ProductSummary) => categories.find((c) => c.id === p.categoryId)?.name ?? ''
  const sorted = sortItems(query.items, f.sort === 'name' ? (p) => p.name : f.sort === 'type' ? typeName : f.sort, (p) => p.createdAt)
  const rows: ResultRow[] = sorted.map((p) => ({
    key: p.id,
    label: p.name,
    thumb: sources.designSrc(p) || undefined,
    badge: sources.hasNoDesign(p.id) ? 'No design file' : undefined,
    onVisible: () => sources.prefetch(p.id),
    checked: selection.has(p.id),
    type: typeName(p),
    cells: [p.name, typeName(p), p.sizes.join(', '), formatDate(p.createdAt)],
  }))

  const active = [
    debounced && `Search "${debounced}"`,
    f.categoryId && `Type: ${categories.find((c) => c.id === f.categoryId)?.name ?? '…'}`,
    f.status && `Status: ${STATUS_LABELS[f.status]}`,
  ].filter((x): x is string => !!x)

  /** Quick add (1 × default size each), or with `options` one add dialog per product. */
  const add = async (options: boolean) => {
    const all = [...selection.map.values()]
    const missing = all.filter((p) => sources.hasNoDesign(p.id))
    const msg = missing.length > 0 ? `No design file for ${missing.map((p) => p.name).join(', ')}` : null
    noticeRef.current = msg
    setNotice(msg)
    const picked = all.filter((p) => !missing.includes(p))
    if (options || picked.length === 0) return dialogs.start(picked)
    setAdding(true)
    try {
      const res = await quickAdd(picked)
      selection.remove(res.addedIds)
      // Close only when everything went in; otherwise stay open with the reason and the rest still selected.
      if (!res.error && missing.length === 0) {
        if (res.addedIds.length > 0) onAdded()
        return
      }
      if (res.error) setNotice((cur) => (cur ? `${cur}. ${res.error}` : res.error))
      if (res.addedIds.length > 0) getViewportStore().getState().autoView()
    } finally {
      setAdding(false)
    }
  }
  const closeDialog = () => {
    if (dialogs.current) selection.remove([dialogs.current.id])
    dialogs.next()
  }

  return (
    <>
      <BrowserLayout
        searchLabel="Search products"
        search={search}
        onSearch={setSearch}
        noun="products"
        filters={
          <>
            <select aria-label="Type" value={f.categoryId} onChange={(e) => setF({ categoryId: e.target.value })}>
              <option value="">All types</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value as ProductPrefs['status'] })}>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {v ? l : 'All statuses'}
                </option>
              ))}
            </select>
            <select aria-label="Sort" value={f.sort} onChange={(e) => setF({ sort: e.target.value as ProductSort })}>
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
          setF({ categoryId: DEFAULT_PRODUCT_PREFS.categoryId, status: DEFAULT_PRODUCT_PREFS.status })
        }}
        error={query.error ?? lookupError ?? notice}
        results={
          <ResultsView
            rows={rows}
            columns={COLUMNS}
            view={prefs.view}
            thumbSize={prefs.thumbSize}
            sort={f.sort}
            onSort={(sort) => setF({ sort })}
            onToggle={(k) => {
              const p = query.items.find((x) => x.id === k)
              if (p) selection.toggle(k, p)
            }}
            onSelectPage={(on) => selection.setMany(query.items.map((p) => [p.id, p]), on)}
            onAdd={() => void add(false)}
          />
        }
        paging={{ page: query.page, offset: (query.page - 1) * prefs.pageSize, count: query.items.length, total: query.total, hasNext: query.hasNext, loading: query.loading, onPage: query.goTo }}
        selectedCount={selection.size}
        hiddenCount={[...selection.map.keys()].filter((k) => !query.items.some((x) => x.id === k)).length}
        adding={adding}
        onAdd={(e) => void add(!!e?.shiftKey)}
        footerActions={
          <button type="button" disabled={selection.size === 0 || adding} onClick={() => void add(true)}>
            Add with options…
          </button>
        }
      />
      {dialogs.current && <AddProductDialog key={dialogs.current.id} product={dialogs.current} onClose={closeDialog} />}
    </>
  )
}
