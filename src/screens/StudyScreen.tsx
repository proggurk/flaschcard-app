import { useEffect, useState, type CSSProperties } from 'react'
import { getStudyQueue, rateCard, NEW_CARDS_PER_DAY, type StudyCard } from '../lib/study.ts'
import { schedule, Rating } from '../../shared/srs.ts'
import { formatInterval, formatWhen } from '../lib/format.ts'
import CardHtml from '../components/CardHtml.tsx'

const BUTTONS = [
  { rating: Rating.Again, label: 'Again' },
  { rating: Rating.Hard, label: 'Hard' },
  { rating: Rating.Good, label: 'Good' },
  { rating: Rating.Easy, label: 'Easy' },
] as const

interface Session {
  queue: StudyCard[]
  shownAt: number // when the current card appeared
  nextDueAt: number | null
  newLimitReached: boolean
}

export default function StudyScreen({ deckId, onExit }: { deckId: string, onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isFlipped, setIsFlipped] = useState(false)
  const [round, setRound] = useState(0) // bumped after each answer to reload the queue

  useEffect(() => {
    let alive = true
    void getStudyQueue(deckId).then((q) => {
      if (alive) setSession({ ...q, shownAt: Date.now() })
    })
    return () => { alive = false }
  }, [deckId, round])

  async function answer(card: StudyCard, rating: Rating, shownAt: number) {
    await rateCard(card.card.id, rating, shownAt)
    setIsFlipped(false)
    setRound((r) => r + 1)
  }

  if (session === null) return <p>Loading…</p>

  const current = session.queue[0]
  if (!current) {
    return (
      <div style={{ textAlign: 'center' }}>
        <h2>All done for now! 🎉</h2>
        {session.newLimitReached && <p>You've had today's {NEW_CARDS_PER_DAY} new cards. More tomorrow!</p>}
        {session.nextDueAt && <p>Next card is due {formatWhen(session.nextDueAt)}.</p>}
        <button onClick={onExit}>Back</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ alignSelf: 'stretch', display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onExit}>← Back</button>
        <span style={{ fontSize: 13, color: '#666' }}>
          {session.queue.length} left{current.isNew && ' · new card'}
        </span>
      </div>

      <div onClick={() => setIsFlipped(!isFlipped)}
        style={{ width: '100%', maxWidth: 420, height: 340, perspective: 1000, cursor: 'pointer', marginTop: 24 }}>
        <div style={{
          width: '100%', height: '100%', position: 'relative',
          transition: 'transform 0.6s ease-in-out', transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}>
          <div style={{ ...faceStyle, backgroundColor: '#ffffff' }}>
            <CardHtml html={current.card.front} />
          </div>
          <div style={{ ...faceStyle, backgroundColor: '#f0fdf4', transform: 'rotateY(180deg)' }}>
            {/* Only render the back once flipped, so audio on the answer doesn't give it away */}
            {isFlipped && <CardHtml html={current.card.back} />}
          </div>
        </div>
      </div>

      <p style={{ color: '#888', fontSize: 14 }}>(Click the card to flip it)</p>

      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
        opacity: isFlipped ? 1 : 0, transition: 'opacity 0.4s', pointerEvents: isFlipped ? 'auto' : 'none',
      }}>
        {BUTTONS.map(({ rating, label }) => (
          <button key={rating} style={btnStyle} onClick={() => void answer(current, rating, session.shownAt)}>
            {label}
            {/* When you'd see the card again with this answer */}
            <small style={{ display: 'block', color: '#888' }}>
              {formatInterval(schedule(current.state, rating, session.shownAt).dueAt - session.shownAt)}
            </small>
          </button>
        ))}
      </div>
    </div>
  )
}

const faceStyle: CSSProperties = {
  position: 'absolute', width: '100%', height: '100%', backfaceVisibility: 'hidden',
  display: 'flex', flexDirection: 'column', justifyContent: 'safe center', borderRadius: 16,
  border: '2px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  textAlign: 'center', padding: 20, boxSizing: 'border-box', overflowY: 'auto',
}

const btnStyle: CSSProperties = {
  padding: '10px 16px', fontSize: 16, borderRadius: 8,
  border: '1px solid #ccc', cursor: 'pointer', backgroundColor: '#fff',
}
