import { useCallback, useEffect, useState } from 'react'
import { useDtfClient } from '../../api/DtfClientContext'
import { AuthRequiredError } from '../../api/dtfClient'

/** An error message plus a stable handler that records it (and asks for sign-in on auth errors). */
export function useErrorHandler(): [string | null, (e: unknown) => void, (msg: string | null) => void] {
  const { client, requireLogin } = useDtfClient()
  const [error, setError] = useState<string | null>(null)
  // A new client means a new sign-in: the old error (usually "sign in") no longer applies.
  useEffect(() => setError(null), [client])
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AuthRequiredError) requireLogin()
      setError(e instanceof Error ? e.message : String(e))
    },
    [requireLogin],
  )
  return [error, fail, setError]
}
