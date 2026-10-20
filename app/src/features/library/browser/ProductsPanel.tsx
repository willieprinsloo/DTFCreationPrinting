import { useState } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { ProductSummary } from '../../../api/types'
import { DEFAULT_PRODUCT_PREFS, type ProductPrefs, type ProductSort } from '../../../state/libraryPrefs'
import { AddProductDialog } from '../AddProductDialog'
import { formatDate } from '../format'
import { useLookup } from '../queries/useLookup'
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
  const dialogs = useDialogQueue<ProductSummary>(onAdded)

  const typeName = (p: ProductSummary) => categories.find((c) => c.id === p.categoryId)?.name ?? ''
  const sorted = sortItems(query.items, f.sort === 'name' ? (p) => p.name : f.sort === 'type' ? typeName : f.sort, (p) => p.createdAt)
  const rows: ResultRow[] = sorted.map((p) => ({
    key: p.id,
    label: p.name,
    thumb: p.thumbnailUrl ? client.absoluteUrl(p.thumbnailUrl) : undefined,
    checked: selection.has(p.id),
    cells: [p.name, typeName(p), p.sizes.join(', '), formatDate(p.createdAt)],
  }))

  const active = [
    debounced && `Search "${debounced}"`,
    f.categoryId && `Type: ${categories.find((c) => c.id === f.categoryId)?.name ?? '…'}`,
    f.status && `Status: ${STATUS_LABELS[f.status]}`,
  ].filter((x): x is string => !!x)

  const add = () => dialogs.start([...selection.map.values()])
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
        error={query.error ?? lookupError}
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
            onAdd={add}
          />
        }
        paging={{ page: query.page, offset: (query.page - 1) * prefs.pageSize, count: query.items.length, total: query.total, hasNext: query.hasNext, loading: query.loading, onPage: query.goTo }}
        selectedCount={selection.size}
        hiddenCount={[...selection.map.keys()].filter((k) => !query.items.some((x) => x.id === k)).length}
        onAdd={add}
      />
      {dialogs.current && <AddProductDialog key={dialogs.current.id} product={dialogs.current} onClose={closeDialog} />}
    </>
  )
}
