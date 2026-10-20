import type { ReactNode } from 'react'

interface Props {
  src: string
  label: string
  caption?: ReactNode
  selected: boolean
  onToggle(): void
  onPointerDown(e: React.PointerEvent): void
}

export function Thumb({ src, label, caption, selected, onToggle, onPointerDown }: Props) {
  return (
    <button
      type="button"
      className={`thumb${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      aria-label={label}
      onClick={onToggle}
      onPointerDown={onPointerDown}
    >
      <img src={src} alt="" loading="lazy" draggable={false} />
      <span className="thumb-caption">{caption ?? label}</span>
    </button>
  )
}
