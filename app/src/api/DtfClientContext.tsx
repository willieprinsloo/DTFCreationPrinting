import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { AuthRequiredError, createDtfClient, type DtfClient } from './dtfClient'
import { loadCredentials } from '../platform/tauri'
import { getSettingsStore, useSettings } from '../state/settingsStore'
import { adoptActiveProfile } from '../features/sheets/sheetFiles'
import { LoginDialog } from '../features/auth/LoginDialog'

export interface DtfClientValue {
  client: DtfClient
  /** Opens the sign-in dialog; call when an AuthRequiredError surfaces. */
  requireLogin(): void
}

export const DtfClientContext = createContext<DtfClientValue | null>(null)

export function useDtfClient(): DtfClientValue {
  const v = useContext(DtfClientContext)
  if (!v) throw new Error('useDtfClient must be used inside DtfClientProvider')
  return v
}

const safeLoadCredentials = () => loadCredentials().catch(() => null)

export function DtfClientProvider({ children }: { children: ReactNode }) {
  const apiBaseUrl = useSettings((s) => s.apiBaseUrl)
  const [ready, setReady] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    getSettingsStore()
      .getState()
      .load()
      .catch(() => {})
      .finally(() => {
        adoptActiveProfile()
        setReady(true)
      })
  }, [])

  const client = useMemo(
    () => createDtfClient({ baseUrl: apiBaseUrl, fetch: tauriFetch as typeof fetch, loadCredentials: safeLoadCredentials }),
    [apiBaseUrl],
  )

  // On start (and when the server address changes): sign in silently, or ask.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      const creds = await safeLoadCredentials()
      if (cancelled) return
      if (!creds) {
        setLoginOpen(true)
        return
      }
      try {
        await client.login(creds)
      } catch (e) {
        if (!cancelled && e instanceof AuthRequiredError) setLoginOpen(true)
        // Other failures (offline) are fine: the app works from cached files.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, client])

  const requireLogin = useCallback(() => setLoginOpen(true), [])
  const value = useMemo(() => ({ client, requireLogin }), [client, requireLogin])

  return (
    <DtfClientContext.Provider value={value}>
      {children}
      {loginOpen && <LoginDialog client={client} onClose={() => setLoginOpen(false)} />}
    </DtfClientContext.Provider>
  )
}
