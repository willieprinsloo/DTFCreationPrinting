import { useEffect, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import type { Customer } from '../../api/types'
import { useDebounced } from './useDebounced'

interface Props {
  value: { id: string; name: string } | null
  onChange(c: Customer | null): void
  onError(e: unknown): void
}

/** "Customer" chip with a searchable menu; when set, the chip shows the name and clears on click. */
export function CustomerPicker({ value, onChange, onError }: Props) {
  const { client } = useDtfClient()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<Customer[]>([])
  const debounced = useDebounced(q.trim(), 300)

  useEffect(() => {
    if (!open) return
    client.listCustomers(debounced || undefined).then(setOptions).catch(onError)
  }, [client, open, debounced, onError])

  return (
    <div className="chip-wrap">
      {value ? (
        <button type="button" className="chip active" onClick={() => onChange(null)} aria-label={`Customer: ${value.name} (clear)`}>
          Customer: {value.name} ×
        </button>
      ) : (
        <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Customer
        </button>
      )}
      {open && !value && (
        <div className="chip-menu" role="listbox" aria-label="Customers">
          <input type="search" placeholder="Find customer" aria-label="Find customer" value={q} onChange={(e) => setQ(e.target.value)} />
          {options.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
