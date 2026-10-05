import { useState, type FormEvent } from 'react'
import type { LocalUser } from '../lib/db.ts'
import { authenticate } from '../lib/session.ts'

export default function AuthScreen({ onLogin }: { onLogin: (user: LocalUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onLogin(await authenticate(mode, email, password))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>
      <input type="email" placeholder="Email" autoComplete="email" required
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Password (at least 8 characters)" required
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        minLength={mode === 'signup' ? 8 : undefined}
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p style={{ color: 'crimson', whiteSpace: 'pre-line', margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null) }}>
        {mode === 'login' ? 'No account? Create one' : 'Already have an account? Log in'}
      </button>
    </form>
  )
}
