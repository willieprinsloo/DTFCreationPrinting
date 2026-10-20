import { useCallback, useEffect, useRef, useState } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import { AuthRequiredError } from '../../../api/dtfClient'
import type { Page } from '../../../api/types'

export interface PagedQuery<T> {
  items: T[]
  page: number
  total: number
  hasNext: boolean
  loading: boolean
  error: string | null
  /** Appends the next page (drawer infinite scroll). */
  loadMore(): void
  /** Replaces the list with page `p` (browser paging). */
  goTo(p: number): void
}

/**
 * Loads page 1 whenever `fetchPage` changes (memoise it on the filters). Stale responses are
 * dropped; on failure the loaded items stay and `error` is set (sign-in is requested on auth errors).
 */
export function usePagedQuery<T extends { id: string }>(fetchPage: (page: number) => Promise<Page<T>>): PagedQuery<T> {
  const { requireLogin } = useDtfClient()
  const [items, setItems] = useState<T[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(
    async (p: number, append: boolean) => {
      const gen = ++generation.current
      setLoading(true)
      setError(null)
      try {
        const res = await fetchPage(p)
        if (gen !== generation.current) return
        setItems((cur) => (append ? [...cur, ...res.items.filter((r) => !cur.some((c) => c.id === r.id))] : res.items))
        setPage(p)
        setTotal(res.total)
        setHasNext(res.hasNext)
      } catch (e) {
        if (gen !== generation.current) return
        if (e instanceof AuthRequiredError) requireLogin()
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (gen === generation.current) setLoading(false)
      }
    },
    [fetchPage, requireLogin],
  )

  useEffect(() => {
    void load(1, false)
  }, [load])

  const loadMore = () => {
    if (hasNext && !loading) void load(page + 1, true)
  }
  const goTo = (p: number) => void load(Math.max(1, p), false)

  return { items, page, total, hasNext, loading, error, loadMore, goTo }
}
