import { useEffect, useRef, type RefObject } from 'react'

/** Calls `onVisible` once when the element first scrolls into view (immediately where IntersectionObserver is missing). */
export function useOnVisible(ref: RefObject<Element | null>, onVisible: () => void) {
  const cb = useRef(onVisible)
  cb.current = onVisible
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      cb.current()
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        cb.current()
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
}
