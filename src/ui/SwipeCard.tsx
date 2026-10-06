// Tinder-style swipe for a card: drag it sideways and it follows your finger
// with a slight tilt; let go far enough (or flick it) and it flies off screen,
// otherwise it springs back. controls.fly() sends it off the same way from a
// button or key. Give each card its own key, so every card starts fresh.
//
// Movement is written straight to the element's style (no React re-render per
// frame), plus a --swipe variable from -1 (full left) to 1 (full right) that
// the CSS uses to fade in the "Know" / "Don't know" stamps.
import { useEffect, useImperativeHandle, useRef, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react'

export type SwipeDirection = 'left' | 'right'
export interface SwipeControls { fly: (direction: SwipeDirection) => void }

const THRESHOLD = 0.3 // share of the card's width you need to drag past
const FLICK_SPEED = 0.6 // px per ms: a fast flick counts even if it's short
const FLY_MS = 280

interface Drag { pointerId: number, x0: number, y0: number, t0: number, dx: number, active: boolean, past: boolean }

export default function SwipeCard({ enabled, onSwipe, controls, children }: {
  enabled: boolean
  onSwipe: (direction: SwipeDirection) => void
  controls: Ref<SwipeControls>
  children: ReactNode
}) {
  const element = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const flying = useRef(false)
  const swallowClick = useRef(false)

  function move(dx: number, transition = 'none') {
    const el = element.current
    if (!el) return
    el.style.transition = transition
    el.style.transform = dx === 0 ? '' : `translateX(${dx}px) rotate(${dx * 0.05}deg)`
    el.style.setProperty('--swipe', String(Math.max(-1, Math.min(1, dx / (el.offsetWidth * THRESHOLD)))))
  }

  function fly(direction: SwipeDirection) {
    const el = element.current
    if (!el || flying.current) return
    flying.current = true
    const sign = direction === 'right' ? 1 : -1
    el.style.transition = `transform ${FLY_MS}ms cubic-bezier(0.3, 0.5, 0.4, 1), opacity ${FLY_MS}ms ease-in`
    el.style.transform = `translateX(${sign * el.offsetWidth * 1.5}px) rotate(${sign * 18}deg)`
    el.style.opacity = '0'
    el.style.setProperty('--swipe', String(sign))
    buzz()
    setTimeout(() => onSwipe(direction), FLY_MS - 60)
  }

  useImperativeHandle(controls, () => ({ fly }))

  // While a swipe is under way the touch is ours: no scrolling and no browser
  // gestures (like swipe-to-go-back). Needs a non-passive native listener;
  // React's touch handlers are passive and can't cancel anything.
  useEffect(() => {
    const el = element.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => { if (drag.current?.active) e.preventDefault() }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!enabled || flying.current || e.button > 0) return
    // Let audio controls, links and hints work normally
    if ((e.target as HTMLElement).closest('audio, video, a, details, button')) return
    drag.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, dx: 0, active: false, past: false }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = element.current
    if (!d || !el || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.x0
    if (!d.active) {
      if (Math.abs(dx) < 8) return
      // Mostly vertical: the user is scrolling a long card, not swiping
      if (Math.abs(e.clientY - d.y0) > Math.abs(dx)) { drag.current = null; return }
      d.active = true
      el.setPointerCapture(e.pointerId)
    }
    d.dx = dx
    move(dx)
    // A small tick when you cross the point where letting go counts
    const past = Math.abs(dx) > el.offsetWidth * THRESHOLD
    if (past && !d.past) buzz()
    d.past = past
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = element.current
    drag.current = null
    if (!d?.active || !el) return
    swallowClick.current = true // the drag shouldn't also count as a tap (flip)
    const fast = Math.abs(d.dx) / Math.max(1, e.timeStamp - d.t0) > FLICK_SPEED && Math.abs(d.dx) > 30
    if (Math.abs(d.dx) > el.offsetWidth * THRESHOLD || fast) fly(d.dx > 0 ? 'right' : 'left')
    else move(0, 'transform 0.4s var(--ease-ios)')
  }

  function onPointerCancel() {
    if (drag.current?.active) move(0, 'transform 0.4s var(--ease-ios)')
    drag.current = null
  }

  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <div ref={element} className="swipe" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onClickCapture={onClickCapture}>
      {children}
      <span className="stamp know" aria-hidden="true">Know</span>
      <span className="stamp dont" aria-hidden="true">Don't know</span>
    </div>
  )
}

// Haptic tick where supported (Android; iOS Safari has no vibration API)
function buzz() {
  if ('vibrate' in navigator) navigator.vibrate(8)
}
