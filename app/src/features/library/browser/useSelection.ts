import { useCallback, useState } from 'react'

/** Selected items by key; survives paging so a selection can span pages. */
export function useSelection<T>() {
  const [map, setMap] = useState<ReadonlyMap<string, T>>(new Map())
  const toggle = useCallback((key: string, item: T) => {
    setMap((cur) => {
      const next = new Map(cur)
      if (next.has(key)) next.delete(key)
      else next.set(key, item)
      return next
    })
  }, [])
  const setMany = useCallback((entries: Array<[string, T]>, on: boolean) => {
    setMap((cur) => {
      const next = new Map(cur)
      for (const [k, v] of entries) {
        if (on) next.set(k, v)
        else next.delete(k)
      }
      return next
    })
  }, [])
  const remove = useCallback((keys: string[]) => setMany(keys.map((k) => [k, undefined as T]), false), [setMany])
  return { map, size: map.size, has: (k: string) => map.has(k), toggle, setMany, remove }
}
