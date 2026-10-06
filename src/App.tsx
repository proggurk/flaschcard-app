import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import type { LocalUser } from './lib/db.ts'
import { checkSession, getCachedUser } from './lib/session.ts'
import { onSynced, startBackgroundSync } from './lib/sync.ts'
import { NavContext, isModal, type Nav, type Route, type Tab } from './ui/nav.ts'
import { isStandalone, useExit } from './ui/hooks.ts'
import Icon, { type IconName } from './ui/icons.tsx'
import AuthScreen from './screens/AuthScreen.tsx'
import TodayScreen from './screens/TodayScreen.tsx'
import DeckScreen from './screens/DeckScreen.tsx'
import StudyScreen from './screens/StudyScreen.tsx'
import StatsScreen from './screens/StatsScreen.tsx'
import ExamScreen from './screens/ExamScreen.tsx'
import FriendsScreen from './screens/FriendsScreen.tsx'
import ProfileScreen from './screens/ProfileScreen.tsx'
import AddSheet from './screens/AddSheet.tsx'

export default function App() {
  const [user, setUser] = useState<LocalUser | null | undefined>(undefined) // undefined = still loading

  useEffect(() => {
    void (async () => {
      // Show the remembered user immediately (works offline)...
      setUser(await getCachedUser())
      // ...then confirm with the server if we can reach it
      const fresh = await checkSession()
      if (fresh !== 'offline') setUser(fresh)
    })()
  }, [])

  if (user === undefined) {
    return <div className="app"><div className="loading-screen"><img src="/icon-192.png" alt="" /></div></div>
  }
  if (user === null) return <div className="app"><AuthScreen onLogin={setUser} /></div>
  // Keyed by user, so logging in as someone else starts from a clean slate
  return <Shell key={user.id} user={user} onUserChange={setUser} />
}

// ---- Logged-in app: tabs, pushed screens, the add sheet ----------------------------

interface Entry { id: number, route: Route }

interface NavState {
  stack: Entry[]
  leaving: Entry | null // just popped, still animating out
  sheet: boolean
}

const TABS: { tab: Tab | 'add', icon: IconName, label: string }[] = [
  { tab: 'today', icon: 'calendar', label: 'Today' },
  { tab: 'stats', icon: 'chart', label: 'Stats' },
  { tab: 'add', icon: 'plus', label: 'Add' },
  { tab: 'friends', icon: 'people', label: 'Friends' },
  { tab: 'profile', icon: 'person', label: 'Profile' },
]

let nextEntryId = 1

function Shell({ user, onUserChange }: { user: LocalUser, onUserChange: (user: LocalUser | null) => void }) {
  const [tab, setTab] = useState<Tab>('today')
  const [nav, setNav] = useState<NavState>({ stack: [], leaving: null, sheet: false })
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  // Set by the swipe-back gesture: the screen is already off-screen, skip the exit animation
  const skipExitAnimation = useRef(false)

  useEffect(() => {
    const stopSync = startBackgroundSync()
    const unsubscribe = onSynced((result) => {
      if (result === 'unauthenticated') onUserChange(null) // session expired: log in again, local data is kept
      else refresh()
    })
    return () => { stopSync(); unsubscribe() }
  }, [onUserChange, refresh])

  // Every pushed screen and the sheet get a browser history entry, so the
  // Android back button, a desktop browser's Back and edge-swipes all close them.
  useEffect(() => {
    const onPopState = () => {
      const instant = skipExitAnimation.current
      skipExitAnimation.current = false
      setNav((s) => {
        if (s.sheet) return { ...s, sheet: false }
        if (s.stack.length === 0) return s
        const top = s.stack[s.stack.length - 1]
        return { stack: s.stack.slice(0, -1), leaving: instant ? null : top, sheet: false }
      })
      refresh() // the screen underneath may show data that just changed
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [refresh])

  // How many history entries the app has pushed (screens + the open sheet)
  const depth = useRef(0)
  useEffect(() => { depth.current = nav.stack.length + (nav.sheet ? 1 : 0) }, [nav.stack.length, nav.sheet])

  // Drop the popped screen once its exit animation is done
  useEffect(() => {
    if (!nav.leaving) return
    const timer = setTimeout(() => setNav((s) => ({ ...s, leaving: null })), 320)
    return () => clearTimeout(timer)
  }, [nav.leaving])

  const navApi = useMemo<Nav>(() => ({
    push: (route) => {
      history.pushState({ memcard: true }, '')
      setNav((s) => ({ ...s, stack: [...s.stack, { id: nextEntryId++, route }] }))
    },
    back: () => history.back(),
    setTab: (t) => {
      // Leaving pushed screens behind: drop their history entries too
      if (depth.current > 0) history.go(-depth.current)
      setNav({ stack: [], leaving: null, sheet: false })
      setTab(t)
    },
    openAdd: () => {
      history.pushState({ memcard: true }, '')
      setNav((s) => ({ ...s, sheet: true }))
    },
    version,
    refresh,
  }), [version, refresh])

  const sheet = useExit(nav.sheet ? 'add' : null, 300)
  const top = nav.stack[nav.stack.length - 1]
  const showTabbar = !top || !isModal(top.route)
  const layers = nav.leaving ? [...nav.stack, nav.leaving] : nav.stack

  return (
    <NavContext.Provider value={navApi}>
      <div className="app">
        {/* Covered screens are inert: no focus or screen reader access, like a native app */}
        <div inert={!!top || nav.sheet}>
          {tab === 'today' && <TodayScreen />}
          {tab === 'stats' && <StatsScreen deckId={null} title="Statistics" />}
          {tab === 'friends' && <FriendsScreen user={user} />}
          {tab === 'profile' && <ProfileScreen user={user} onUserChange={onUserChange} />}
        </div>

        {layers.map((entry) => (
          <Layer key={entry.id} route={entry.route} leaving={entry === nav.leaving}
            inert={entry !== top || nav.sheet}
            onSwipeBack={() => { skipExitAnimation.current = true; history.back() }}>
            {renderRoute(entry.route, tab)}
          </Layer>
        ))}

        {showTabbar && (
          <nav className="tabbar" aria-label="Main">
            {TABS.map((t) => t.tab === 'add' ? (
              <button key="add" className="tab add" onClick={navApi.openAdd}>
                <span className="tab-add-circle"><Icon name="plus" size={20} weight={2.6} /></span>
                {t.label}
              </button>
            ) : (
              <button key={t.tab} className={`tab${tab === t.tab && !top ? ' active' : ''}`}
                aria-current={tab === t.tab ? 'page' : undefined}
                onClick={() => navApi.setTab(t.tab as Tab)}>
                <Icon name={t.icon} size={25} weight={1.9} />
                {t.label}
              </button>
            ))}
          </nav>
        )}

        {sheet.shown && <AddSheet leaving={sheet.leaving} onClose={navApi.back} />}
      </div>
    </NavContext.Provider>
  )
}

const TAB_TITLES: Record<Tab, string> = { today: 'Today', stats: 'Stats', friends: 'Friends', profile: 'Profile' }

function renderRoute(route: Route, tab: Tab): ReactNode {
  switch (route.screen) {
    case 'deck': return <DeckScreen deckId={route.deckId} back={TAB_TITLES[tab]} />
    case 'study': return <StudyScreen deckId={route.deckId} />
    case 'exam': return <ExamScreen deckId={route.deckId} title={route.title} />
    case 'stats': return <StatsScreen deckId={route.deckId} title={route.title} back="Deck" />
  }
}

// One pushed screen. Slides in from the right (or rises, for modals). In the
// installed app you can drag it back from the left edge, like on iOS.
function Layer({ route, leaving, inert, onSwipeBack, children }: {
  route: Route
  leaving: boolean
  inert: boolean
  onSwipeBack: () => void
  children: ReactNode
}) {
  const modal = isModal(route)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x0: number, y0: number, t0: number, dx: number, active: boolean } | null>(null)
  const swipeEnabled = !modal && !leaving && isStandalone()

  function onTouchStart(e: TouchEvent) {
    const el = ref.current
    const t = e.touches[0]
    if (!swipeEnabled || !el || t.clientX - el.getBoundingClientRect().left > 24) return
    drag.current = { x0: t.clientX, y0: t.clientY, t0: e.timeStamp, dx: 0, active: false }
  }

  function onTouchMove(e: TouchEvent) {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const t = e.touches[0]
    d.dx = t.clientX - d.x0
    if (!d.active) {
      // Mostly vertical: it's a scroll, not a swipe
      if (Math.abs(t.clientY - d.y0) > Math.abs(d.dx)) { drag.current = null; return }
      if (d.dx < 8) return
      d.active = true
      el.classList.add('swiping')
    }
    el.style.transform = `translateX(${Math.max(0, d.dx)}px)`
  }

  function onTouchEnd(e: TouchEvent) {
    const d = drag.current
    const el = ref.current
    drag.current = null
    if (!d?.active || !el) return
    const width = el.offsetWidth
    const fast = d.dx / Math.max(1, e.timeStamp - d.t0) > 0.5 // px per ms
    el.classList.add('settling')
    if (d.dx > width * 0.35 || (fast && d.dx > 40)) {
      el.style.transform = `translateX(${width}px)`
      setTimeout(onSwipeBack, 230)
    } else {
      el.style.transform = ''
      setTimeout(() => el.classList.remove('swiping', 'settling'), 260)
    }
  }

  return (
    <div ref={ref} className={`layer ${modal ? 'modal' : 'push'}${leaving ? ' leaving' : ''}`} inert={inert}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      {children}
    </div>
  )
}
