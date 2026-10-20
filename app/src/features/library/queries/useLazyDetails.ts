import { useRef, useSyncExternalStore } from 'react'

export interface LazyLoader<V> {
  /** Cached value, the in-flight request, or a new request (queued behind the concurrency limit). Failures are forgotten so they can be retried. */
  get(key: string): Promise<V>
  peek(key: string): V | undefined
  /** Immutable map of everything loaded so far; replaced on every change. */
  snapshot(): Record<string, V>
  subscribe(fn: () => void): () => void
}

/** A keyed cache with a bounded pool of concurrent requests. */
export function createLazyLoader<V>(fetcher: (key: string) => Promise<V>, concurrency = 4): LazyLoader<V> {
  let values: Record<string, V> = {}
  const reqs = new Map<string, Promise<V>>()
  const listeners = new Set<() => void>()
  const slots = { active: 0, waiting: [] as Array<() => void> }

  const withSlot = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (slots.active >= concurrency) await new Promise<void>((r) => slots.waiting.push(r))
    else slots.active++
    try {
      return await fn()
    } finally {
      // Hand the slot straight to the next waiter so the count never dips and lets one extra in.
      const next = slots.waiting.shift()
      if (next) next()
      else slots.active--
    }
  }

  return {
    get(key) {
      let p = reqs.get(key)
      if (!p) {
        p = withSlot(() => fetcher(key)).then((v) => {
          values = { ...values, [key]: v }
          listeners.forEach((l) => l())
          return v
        })
        p.catch(() => {
          reqs.delete(key)
        })
        reqs.set(key, p)
      }
      return p
    },
    peek: (key) => values[key],
    snapshot: () => values,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

/** Subscribes the component to a loader and returns its loaded values. */
export function useLoader<V>(loader: LazyLoader<V>): Record<string, V> {
  return useSyncExternalStore(loader.subscribe, loader.snapshot)
}

/** Lazy, cached, concurrency-limited details per key (default 4 requests at a time). */
export function useLazyDetails<V>(fetcher: (key: string) => Promise<V>, opts: { concurrency?: number } = {}) {
  const latest = useRef(fetcher)
  latest.current = fetcher
  const loader = useRef<LazyLoader<V>>(null)
  loader.current ??= createLazyLoader((k) => latest.current(k), opts.concurrency)
  const values = useLoader(loader.current)
  return { values, get: loader.current.get, peek: loader.current.peek }
}
