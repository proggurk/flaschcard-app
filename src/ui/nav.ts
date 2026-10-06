// App navigation: four tabs, plus a stack of screens pushed on top
// (a deck, studying, an exam...). App.tsx owns the state; screens use useNav().
import { createContext, useContext } from 'react'

export type Tab = 'today' | 'stats' | 'friends' | 'profile'

export type Route =
  | { screen: 'deck', deckId: string }
  | { screen: 'study', deckId: string }
  | { screen: 'exam', deckId: string | null, title: string }
  | { screen: 'stats', deckId: string, title: string }

// Studying and exams cover the whole screen and rise from the bottom (like an
// iOS full-screen modal); the rest slide in from the right with the tab bar visible.
export const isModal = (route: Route) => route.screen === 'study' || route.screen === 'exam'

export interface Nav {
  push: (route: Route) => void
  back: () => void
  setTab: (tab: Tab) => void
  openAdd: () => void
  // Bumped whenever local data may have changed (after a sync, an import, or
  // coming back from a pushed screen). Screens reload when it changes.
  version: number
  refresh: () => void
}

export const NavContext = createContext<Nav | null>(null)

export function useNav(): Nav {
  const nav = useContext(NavContext)
  if (!nav) throw new Error('useNav() outside <NavContext.Provider>')
  return nav
}
