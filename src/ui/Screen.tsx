// An iOS-style screen: a navigation bar that turns translucent (with the small
// title) once the large title scrolls away, and a scrolling body.
import { useState, type ReactNode, type UIEvent } from 'react'
import Icon from './icons.tsx'
import { useNav } from './nav.ts'

interface Props {
  title: string
  large?: boolean       // big bold title at the top of the content (default on)
  back?: string         // label of the back button, e.g. "Today"; shows the button
  left?: ReactNode
  right?: ReactNode
  noTabbar?: boolean
  children: ReactNode
}

export default function Screen({ title, large = true, back, left, right, noTabbar, children }: Props) {
  const nav = useNav()
  const [scrolled, setScrolled] = useState(false)

  function onScroll(e: UIEvent<HTMLDivElement>) {
    // The small title appears once the large one is (mostly) out of view
    const next = e.currentTarget.scrollTop > (large ? 38 : 2)
    if (next !== scrolled) setScrolled(next)
  }

  return (
    <div className={`screen${noTabbar ? ' no-tabbar' : ''}`} onScroll={onScroll}>
      <header className={`navbar${scrolled ? ' scrolled' : ''}${large ? '' : ' always-title'}`}>
        <div className="navbar-side">
          {back !== undefined && (
            <button className="nav-btn" onClick={nav.back} aria-label={`Back to ${back}`}>
              <Icon name="chevronLeft" size={22} weight={2.4} />{back}
            </button>
          )}
          {left}
        </div>
        <div className="navbar-title" aria-hidden={large && !scrolled}>{title}</div>
        <div className="navbar-side end">{right}</div>
      </header>
      {large && <h1 className="large-title">{title}</h1>}
      {children}
    </div>
  )
}
