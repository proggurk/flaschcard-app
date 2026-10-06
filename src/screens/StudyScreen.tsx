import { useEffect, useState } from 'react'
import { getStudyQueue, rateCard, NEW_CARDS_PER_DAY } from '../lib/study.ts'
import { schedule, Rating } from '../../shared/srs.ts'
import { formatInterval, formatWhen } from '../lib/format.ts'
import CardHtml from '../components/CardHtml.tsx'
import { useNav } from '../ui/nav.ts'
import { useLoad } from '../ui/hooks.ts'
import Icon from '../ui/icons.tsx'

const BUTTONS = [
  { rating: Rating.Again, label: 'Again', className: 'again' },
  { rating: Rating.Hard, label: 'Hard', className: 'hard' },
  { rating: Rating.Good, label: 'Good', className: 'good' },
  { rating: Rating.Easy, label: 'Easy', className: 'easy' },
] as const

export default function StudyScreen({ deckId }: { deckId: string }) {
  const nav = useNav()
  const [round, setRound] = useState(0) // bumped after each answer to reload the queue
  const [flippedRound, setFlippedRound] = useState<number | null>(null)
  const [answered, setAnswered] = useState(0)

  const session = useLoad(async () => ({ ...(await getStudyQueue(deckId)), round, shownAt: Date.now() }), [deckId, round])

  // The card stays flipped until the next one has loaded, so the next card's
  // answer never shows during the flip-back animation
  const current = session?.queue[0]
  const flipped = session !== undefined && flippedRound === session.round
  const busy = session?.round !== round

  function flip() {
    if (session && !busy) setFlippedRound(flipped ? null : session.round)
  }

  async function answer(rating: Rating) {
    if (!session || !current || busy) return
    await rateCard(current.card.id, rating, session.shownAt)
    setAnswered((n) => n + 1)
    setRound((r) => r + 1)
  }

  // Keyboard: space/enter flips, 1-4 answer, escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') nav.back()
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip() }
      else if (flipped && ['1', '2', '3', '4'].includes(e.key)) void answer(Number(e.key) as Rating)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const remaining = session?.queue.length ?? 0
  const progress = answered + remaining === 0 ? 1 : answered / (answered + remaining)

  return (
    <div className="fullscreen">
      <div className="session-bar">
        <button className="icon-btn" onClick={nav.back} aria-label="Close"><Icon name="close" size={24} /></button>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="session-count" aria-label={`${remaining} cards left`}>{session ? remaining : ''}</span>
      </div>

      {session && current && (
        <>
          <div className="flashcard-area">
            <div key={current.card.id} className={`flashcard${flipped ? ' flipped' : ''}`} onClick={flip}
              role="button" aria-label={flipped ? 'Answer side. Tap to see the question' : 'Tap to show the answer'}>
              <div className="face">
                <span className="face-label">{current.isNew ? 'New card' : 'Question'}</span>
                <CardHtml html={current.card.front} />
                {!flipped && <p className="tap-hint">Tap to show the answer</p>}
              </div>
              <div className="face back">
                <span className="face-label">Answer</span>
                {/* Only rendered once flipped, so audio on the answer doesn't give it away.
                    Anki answers usually repeat the question ({{FrontSide}}); our own cards don't, so add it. */}
                {flipped && current.card.ankiNoteId === null && (
                  <><div className="face-question"><CardHtml html={current.card.front} /></div><hr className="face-divider" /></>
                )}
                {flipped && <CardHtml html={current.card.back} />}
              </div>
            </div>
          </div>

          <div className="answer-bar">
            {flipped ? (
              <div className="ratings">
                {BUTTONS.map(({ rating, label, className }) => (
                  <button key={rating} className={`rating ${className}`} disabled={busy} onClick={() => void answer(rating)}>
                    {label}
                    {/* When you'd see the card again with this answer */}
                    <small>{formatInterval(schedule(current.state, rating, session.shownAt).dueAt - session.shownAt)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn btn-secondary" style={{ height: 60 }} onClick={flip}>Show answer</button>
            )}
          </div>
        </>
      )}

      {session && !current && (
        <div className="done">
          <div className="done-badge"><Icon name="check" size={48} weight={3} /></div>
          <h2 style={{ fontSize: 28, fontWeight: 700 }}>All done for now!</h2>
          <p className="empty-text">
            {answered > 0 && `You answered ${answered} ${answered === 1 ? 'card' : 'cards'}. `}
            {session.newLimitReached && `You've had today's ${NEW_CARDS_PER_DAY} new cards. `}
            {session.nextDueAt && `Next card is due ${formatWhen(session.nextDueAt)}.`}
          </p>
          <button className="btn btn-primary" style={{ marginTop: 24, maxWidth: 280 }} onClick={nav.back}>Done</button>
        </div>
      )}
    </div>
  )
}
