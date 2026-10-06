import { useEffect, useState, type DependencyList } from 'react'

// Load async data for a screen. Returns undefined until the first result;
// while reloading it keeps showing the previous data (no flash of "loading").
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined)
  useEffect(() => {
    let alive = true
    load().then((d) => { if (alive) setData(d) }, (err) => console.error(err))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists the deps
  }, deps)
  return data
}

// Keeps something on screen for `ms` after it closes, so it can animate out.
// Returns the value to render (the last open one while leaving) and whether it's leaving.
export function useExit<T>(value: T | null, ms = 300): { shown: T | null, leaving: boolean } {
  const [shown, setShown] = useState<T | null>(value)
  const [leaving, setLeaving] = useState(false)
  // Opening (or switching to another value) shows it straight away
  if (value !== null && value !== shown) {
    setShown(value)
    setLeaving(false)
  }
  if (value === null && shown !== null && !leaving) setLeaving(true)

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => { setShown(null); setLeaving(false) }, ms)
    return () => clearTimeout(timer)
  }, [leaving, ms])

  return { shown, leaving }
}

// True when opened from the home screen (no browser UI around the app)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
