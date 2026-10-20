import { useRef } from 'react'

/** A ref that always holds the latest value — for callbacks that outlive a render (drag drops, async adds). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
