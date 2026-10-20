import { useCallback, useMemo, useRef } from 'react'
import { useDtfClient } from '../../../api/DtfClientContext'
import type { GalleryDesign } from '../../../api/types'
import { usePagedQuery } from './usePagedQuery'

export interface DesignsFilter { search: string; owner?: string; designType: string; categoryId: string; limit: number }

/** Gallery designs, newest first. `types` collects every design type seen so far (no endpoint lists them). */
export function useDesignsQuery({ search, owner, designType, categoryId, limit }: DesignsFilter) {
  const { client } = useDtfClient()
  const fetchPage = useCallback(
    (page: number) =>
      client.listGalleryDesigns({
        page,
        limit,
        search: search || undefined,
        owner: owner || undefined,
        designType: designType || undefined,
        categoryId: categoryId || undefined,
        sort: 'created_at',
        order: 'desc',
      }),
    [client, search, owner, designType, categoryId, limit],
  )
  const query = usePagedQuery<GalleryDesign>(fetchPage)
  // Derived in render (not an effect) so the options exist as soon as the designs do.
  const seen = useRef<string[]>([])
  const types = useMemo(() => {
    const next = [...new Set([...seen.current, ...query.items.map((d) => d.designType).filter(Boolean)])].sort()
    if (next.length !== seen.current.length) seen.current = next
    return seen.current
  }, [query.items])
  return { ...query, types }
}
