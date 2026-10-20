import { useState, type FormEvent } from 'react'
import type { DtfClient } from '../../api/dtfClient'
import { clearCredentials, saveCredentials } from '../../platform/tauri'

interface Props {
  client: DtfClient
  onClose(): void
}

export function LoginDialog({ client, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await client.login({ email: email.trim(), password })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      return
    }
    try {
      if (remember) await saveCredentials(email.trim(), password)
      else await clearCredentials()
    } catch {
      // Signed in; only remembering failed. Not worth blocking the user.
    }
    onClose()
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="login-title" onSubmit={(e) => void submit(e)}>
        <h2 id="login-title">Sign in to DTF Creations</h2>
        <label className="dialog-field">
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="dialog-field">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="dialog-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Work offline
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}
