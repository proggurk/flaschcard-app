import { useState, type FormEvent } from 'react'
import type { LocalUser } from '../lib/db.ts'
import { authenticate } from '../lib/session.ts'
import { Segmented } from '../ui/controls.tsx'

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
    <div className="auth">
      <img className="auth-logo" src="/icon-192.png" alt="" />
      <h1 className="auth-title">Memcard</h1>
      <p className="auth-tagline">Flashcards that work offline and sync across your devices.</p>

      <Segmented padded label="Account" value={mode} onChange={(m) => { setMode(m); setError(null) }}
        options={[{ value: 'login', label: 'Log in' }, { value: 'signup', label: 'Create account' }]} />

      <form onSubmit={submit} style={{ marginTop: 20 }}>
        <div className="group">
          <label className="row">
            <input className="row-input" type="email" placeholder="Email" autoComplete="email" required
              autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="row">
            <input className="row-input" type="password" required enterKeyHint="go"
              placeholder={mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
        {error && <p className="section-footer error">{error}</p>}
        <div className="pad" style={{ marginTop: 20 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  )
}
