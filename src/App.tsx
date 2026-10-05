// Bare-bones UI for testing the logic. The real design comes later.
import { useEffect, useState } from 'react'
import type { LocalUser } from './lib/db.ts'
import { checkSession, getCachedUser } from './lib/session.ts'
import { onSynced, startBackgroundSync } from './lib/sync.ts'
import AuthScreen from './screens/AuthScreen.tsx'
import HomeScreen from './screens/HomeScreen.tsx'
import StudyScreen from './screens/StudyScreen.tsx'
import StatsScreen from './screens/StatsScreen.tsx'
import ExamScreen from './screens/ExamScreen.tsx'
import SocialScreen from './screens/SocialScreen.tsx'

export type View =
  | { screen: 'home' }
  | { screen: 'study', deckId: string }
  | { screen: 'stats', deckId: string | null, title: string }
  | { screen: 'exam', deckId: string | null, title: string }
  | { screen: 'social' }

export default function App() {
  const [user, setUser] = useState<LocalUser | null | undefined>(undefined) // undefined = still loading
  const [view, setView] = useState<View>({ screen: 'home' })

  useEffect(() => {
    void (async () => {
      // Show the remembered user immediately (works offline)...
      setUser(await getCachedUser())
      // ...then confirm with the server if we can reach it
      const fresh = await checkSession()
      if (fresh !== 'offline') setUser(fresh)
    })()
  }, [])

  useEffect(() => {
    if (!user) return
    const stopSync = startBackgroundSync()
    const unsubscribe = onSynced((result) => {
      if (result === 'unauthenticated') setUser(null) // session expired: log in again, local data is kept
    })
    return () => { stopSync(); unsubscribe() }
  }, [user])

  if (user === undefined) return <div style={page}>Loading…</div>
  if (user === null) return <div style={page}><AuthScreen onLogin={setUser} /></div>

  const home = () => setView({ screen: 'home' })

  return (
    <div style={page}>
      {view.screen === 'study' && <StudyScreen deckId={view.deckId} onExit={home} />}
      {view.screen === 'stats' && <StatsScreen deckId={view.deckId} title={view.title} onExit={home} />}
      {view.screen === 'exam' && <ExamScreen deckId={view.deckId} title={view.title} onExit={home} />}
      {view.screen === 'social' && <SocialScreen user={user} onUserChange={setUser} onExit={home} />}
      {view.screen === 'home' && <HomeScreen user={user} onNavigate={setView} onLogout={() => setUser(null)} />}
    </div>
  )
}

const page = {
  maxWidth: 480,
  margin: '0 auto',
  padding: '24px 16px',
  fontFamily: 'system-ui, sans-serif',
} as const
