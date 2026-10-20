import { useEffect, useState } from 'react'

/** Loads a small reference list (categories) once per `load` identity; failures go to `onError`. */
export function useLookup<T>(load: () => Promise<T[]>, onError: (e: unknown) => void): T[] {
  const [data, setData] = useState<T[]>([])
  useEffect(() => {
    let live = true
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && onError(e))
    return () => {
      live = false
    }
  }, [load, onError])
  return data
}
