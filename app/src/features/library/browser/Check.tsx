import { useEffect, useRef } from 'react'

interface Props {
  checked: boolean | 'mixed'
  label: string
  onChange(): void
  tabIndex?: number
}

/** Checkbox with an indeterminate ('mixed') state. Clicks don't bubble to the row. */
export function Check({ checked, label, onChange, tabIndex }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === 'mixed'
  }, [checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked === true}
      tabIndex={tabIndex}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
