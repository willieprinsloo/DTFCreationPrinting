import { useRef } from 'react'
import type { OrderFile, OrderSummary } from '../../api/types'
import { fileCount, formatDate, statusLabel } from './format'
import { useOnVisible } from './useOnVisible'

interface Props {
  order: OrderSummary
  name: string | undefined
  files: OrderFile[] | undefined
  thumbSrc: string | undefined
  expanded: boolean
  onVisible(): void
  onClick(): void
  onDoubleClick?(): void
  onPointerDown?(e: React.PointerEvent<HTMLButtonElement>): void
}

export function OrderCard({ order, name, files, thumbSrc, expanded, onVisible, onClick, onDoubleClick, onPointerDown }: Props) {
  const ref = useRef<HTMLButtonElement>(null)
  useOnVisible(ref, onVisible)
  const date = formatDate(order.createdAt)
  return (
    <button ref={ref} type="button" className="order-card" aria-expanded={expanded} onClick={onClick} onDoubleClick={onDoubleClick} onPointerDown={onPointerDown}>
      <span className="order-card-thumb">{thumbSrc && <img src={thumbSrc} alt="" loading="lazy" draggable={false} />}</span>
      <strong>{order.orderNumber}</strong>
      <span className="muted">{name || 'Unknown customer'}</span>
      {date && <span className="muted">{date}</span>}
      <span className="muted">{statusLabel(order.status)}</span>
      {files && <span className="muted">{fileCount(files.length)}</span>}
    </button>
  )
}
