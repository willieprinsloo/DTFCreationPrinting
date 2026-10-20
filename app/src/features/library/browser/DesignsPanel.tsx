import { useState } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { GalleryDesign } from '../../../api/types'
import { DEFAULT_DESIGN_PREFS, type DesignPrefs, type DesignSort } from '../../../state/libraryPrefs'
import { AddDesignDialog } from '../AddDesignDialog'
import { CustomerPicker } from '../CustomerPicker'
import { formatDate } from '../format'
import { useDesignsQuery } from '../queries/useDesignsQuery'
import { useLookup } from '../queries/useLookup'
import { useDebounced } from '../useDebounced'
import { useErrorHandler } from '../useErrorHandler'
import { BrowserLayout } from './BrowserLayout'
import { ResultsView, type ResultColumn } from './ResultsView'
import type { ResultRow } from './ResultItem'
import { sortItems } from './sorting'
import { useDialogQueue } from './useDialogQueue'
import { useLibraryPrefs } from './useLibraryPrefs'
import { useSelection } from './useSelection'

const SORTS: Array<[DesignSort, string]> = [['newest', 'Newest'], ['oldest', 'Oldest'], ['name', 'Name A–Z']]
const COLUMNS: ResultColumn<DesignSort>[] = [
  { label: 'Name', sort: 'name' },
  { label: 'Customer / Category' },
  { label: 'Type' },
  { label: 'Created', sort: ['newest', 'oldest'] },
]

export function DesignsPanel({ onAdded }: { onAdded(): void }) {
  const { client } = useDtfClient()
  const [prefs, update] = useLibraryPrefs()
  const f = prefs.designs
  const setF = (patch: Partial<DesignPrefs>) => update({ designs: patch })
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const [lookupError, onLookupError] = useErrorHandler()
  const categories = useLookup(client.listGalleryCategories, onLookupError)
  const query = useDesignsQuery({ search: debounced, owner: f.customerId, designType: f.designType, categoryId: f.categoryId, limit: prefs.pageSize })
  const selection = useSelection<GalleryDesign>()
  const dialogs = useDialogQueue<GalleryDesign>(onAdded)
  const customer = f.customerId ? { id: f.customerId, name: f.customerName } : null

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? ''
  const sorted = sortItems(query.items, f.sort === 'name' ? (d) => d.name : f.sort, (d) => d.createdAt)
  const rows: ResultRow[] = sorted.map((d) => ({
    key: d.id,
    label: d.name,
    thumb: client.absoluteUrl(d.thumbnailUrl ?? d.imageUrl),
    checked: selection.has(d.id),
    cells: [d.name, [customer?.name, categoryName(d.galleryCategoryId)].filter(Boolean).join(' / '), d.designType, formatDate(d.createdAt)],
  }))

  const active = [
    debounced && `Search "${debounced}"`,
    customer && `Customer: ${customer.name}`,
    f.designType && `Type: ${f.designType}`,
    f.categoryId && `Category: ${categoryName(f.categoryId) || '…'}`,
  ].filter((x): x is string => !!x)

  const add = () => dialogs.start([...selection.map.values()])
  const closeDialog = () => {
    if (dialogs.current) selection.remove([dialogs.current.id])
    dialogs.next()
  }

  return (
    <>
      <BrowserLayout
        searchLabel="Search designs"
        search={search}
        onSearch={setSearch}
        noun="designs"
        filters={
          <>
            <CustomerPicker
              value={customer}
              onChange={(c) => setF({ customerId: c?.id ?? '', customerName: c?.name ?? '' })}
              onError={onLookupError}
            />
            <select aria-label="Type" value={f.designType} onChange={(e) => setF({ designType: e.target.value })}>
              <option value="">All types</option>
              {[...new Set([...query.types, ...(f.designType ? [f.designType] : [])])].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select aria-label="Category" value={f.categoryId} onChange={(e) => setF({ categoryId: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select aria-label="Sort" value={f.sort} onChange={(e) => setF({ sort: e.target.value as DesignSort })}>
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
          const { sort: _sort, ...filters } = DEFAULT_DESIGN_PREFS
          setF(filters)
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
              const d = query.items.find((x) => x.id === k)
              if (d) selection.toggle(k, d)
            }}
            onSelectPage={(on) => selection.setMany(query.items.map((d) => [d.id, d]), on)}
            onAdd={add}
          />
        }
        paging={{ page: query.page, offset: (query.page - 1) * prefs.pageSize, count: query.items.length, total: query.total, hasNext: query.hasNext, loading: query.loading, onPage: query.goTo }}
        selectedCount={selection.size}
        hiddenCount={[...selection.map.keys()].filter((k) => !query.items.some((x) => x.id === k)).length}
        onAdd={add}
      />
      {dialogs.current && (
        <AddDesignDialog key={dialogs.current.id} design={dialogs.current} customerName={customer?.name} onClose={closeDialog} />
      )}
    </>
  )
}
