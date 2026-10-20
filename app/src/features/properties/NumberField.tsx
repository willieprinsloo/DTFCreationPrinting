import { useState } from 'react'

interface Props {
  label: string
  value: number
  decimals?: number
  unit?: string
  disabled?: boolean
  /** Show an empty field (with `placeholder`) instead of the value, e.g. for mixed selections. */
  blank?: boolean
  placeholder?: string
  onCommit(value: number): void
}

const format = (v: number, decimals: number) => String(Number(v.toFixed(decimals)))

/** Number input that edits freely and commits on blur or Enter; unparseable text reverts. */
export function NumberField({ label, value, decimals = 1, unit, disabled, blank, placeholder, onCommit }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n)
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          disabled={disabled}
          value={draft ?? (blank ? '' : format(value, decimals))}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setDraft(null)
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  )
}
