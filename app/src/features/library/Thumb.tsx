import type { ReactNode } from 'react'

interface Props {
  src: string
  label: string
  caption?: ReactNode
  selected: boolean
  onToggle(): void
  onDragStart(e: React.DragEvent): void
  onDragEnd(): void
}

export function Thumb({ src, label, caption, selected, onToggle, onDragStart, onDragEnd }: Props) {
  return (
    <button
      type="button"
      className={`thumb${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      aria-label={label}
      draggable
      onClick={onToggle}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <img src={src} alt="" loading="lazy" draggable={false} />
      <span className="thumb-caption">{caption ?? label}</span>
    </button>
  )
}
