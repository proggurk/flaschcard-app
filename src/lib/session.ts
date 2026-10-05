// Login state. The last logged-in user is remembered in IndexedDB so the app
// opens straight into your decks even with no connection.
import { api } from './api.ts'
import { clearLocalData, getMeta, pendingCount, setMeta, type LocalUser } from './db.ts'
import { sync } from './sync.ts'

export async function getCachedUser(): Promise<LocalUser | null> {
  return (await getMeta<LocalUser>('user')) ?? null
}

// Ask the server who we are. Returns null if the session is gone,
// or 'offline' if we can't tell right now.
export async function checkSession(): Promise<LocalUser | null | 'offline'> {
  try {
    const res = await api<{ user: LocalUser }>('GET', '/auth/me')
    if (res.ok) {
      await setMeta('user', res.data.user)
      return res.data.user
    }
    return res.status === 401 ? null : 'offline'
  } catch {
    return 'offline'
  }
}

const ERRORS: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  email_taken: 'An account with that email already exists.',
  too_many_requests: 'Too many attempts. Wait a while and try again.',
}

export async function authenticate(mode: 'login' | 'signup', email: string, password: string): Promise<LocalUser> {
  let res
  try {
    res = await api<{ user: LocalUser, error?: string, issues?: string[] }>('POST', `/auth/${mode}`, { email, password })
  } catch {
    throw new Error('No connection. You need to be online to log in.')
  }
  if (!res.ok) {
    const { error, issues } = res.data
    throw new Error(issues?.join('\n') ?? (error && ERRORS[error]) ?? 'Something went wrong.')
  }

  // Another account was used on this device before: don't mix their data in
  const previous = await getCachedUser()
  if (previous && previous.id !== res.data.user.id) await clearLocalData()

  await setMeta('user', res.data.user)
  void sync()
  return res.data.user
}

// Returns false if the user cancelled or we're offline.
export async function logout(): Promise<boolean> {
  // Push unsynced reviews first so nothing is lost
  await sync()
  const unsynced = await pendingCount()
  if (unsynced > 0 && !confirm(`${unsynced} changes haven't synced yet and will be lost if you log out. Log out anyway?`)) {
    return false
  }
  try {
    await api('POST', '/auth/logout')
  } catch {
    // The session cookie can only be removed by the server
    alert('You need to be online to log out.')
    return false
  }
  await clearLocalData()
  return true
}
