import { useRef, type ReactNode } from 'react'
import { useOnVisible } from './useOnVisible'
import { thumbSrc } from '../../platform/tauri'

interface Props {
  src: string
  label: string
  caption?: ReactNode
  /** Small note over the picture, e.g. "No design file". */
  badge?: string
  /** Called once when the thumbnail scrolls into view. */
  onVisible?(): void
  selected: boolean
  onToggle(): void
  onPointerDown(e: React.PointerEvent): void
}

const noop = () => {}

export function Thumb({ src, label, caption, badge, onVisible, selected, onToggle, onPointerDown }: Props) {
  const ref = useRef<HTMLButtonElement>(null)
  useOnVisible(ref, onVisible ?? noop)
  return (
    <button
      ref={ref}
      type="button"
      className={`thumb${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      aria-label={label}
      onClick={onToggle}
      onPointerDown={onPointerDown}
    >
      {src ? <img src={thumbSrc(src)} alt="" loading="lazy" draggable={false} /> : <span className="thumb-placeholder" data-testid="thumb-placeholder" />}
      {badge && <span className="thumb-badge">{badge}</span>}
      <span className="thumb-caption">{caption ?? label}</span>
    </button>
  )
}
