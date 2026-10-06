import { useEffect, useState } from 'react'
import { getStudyQueue, rateCard, NEW_CARDS_PER_DAY, type StudyCard } from '../lib/study.ts'
import { schedule, Rating } from '../../shared/srs.ts'
import { formatInterval, formatWhen } from '../lib/format.ts'
import CardHtml from '../components/CardHtml.tsx'
import { useNav } from '../ui/nav.ts'
import { useLoad } from '../ui/hooks.ts'
import Icon from '../ui/icons.tsx'

// A card you didn't know comes back after this many other cards (or straight
// away if nothing else is left): the session isn't over until you know it.
const REPEAT_AFTER = 3

export default function StudyScreen({ deckId }: { deckId: string }) {
  const nav = useNav()
  const [round, setRound] = useState(0) // bumped after each answer to reload the queue
  const [flippedRound, setFlippedRound] = useState<number | null>(null)
  const [answered, setAnswered] = useState(0)
  // This session: when each card was last not known (answer number), and which cards are done
  const [missedAt, setMissedAt] = useState<Record<string, number>>({})
  const [finished, setFinished] = useState<string[]>([])

  const session = useLoad(async () => ({ ...(await getStudyQueue(deckId)), round, shownAt: Date.now() }), [deckId, round])

  const current = session && pickNext(session.queue, missedAt, answered)
  // The card stays flipped until the next one has loaded, so the next card's
  // answer never shows during the flip-back animation
  const flipped = session !== undefined && flippedRound === session.round
  const busy = session?.round !== round

  function flip() {
    if (session && !busy) setFlippedRound(flipped ? null : session.round)
  }

  async function answer(rating: Rating) {
    if (!session || !current || busy) return
    const id = current.card.id
    await rateCard(id, rating, session.shownAt)
    if (rating === Rating.DontKnow) setMissedAt((m) => ({ ...m, [id]: answered + 1 }))
    else setFinished((f) => (f.includes(id) ? f : [...f, id]))
    setAnswered((n) => n + 1)
    setRound((r) => r + 1)
  }

  // Keyboard: space/enter flips; then 1 or ← = don't know, 2 or → = know; escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') nav.back()
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip() }
      else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) void answer(Rating.DontKnow)
      else if (flipped && (e.key === '2' || e.key === 'ArrowRight')) void answer(Rating.Know)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const remaining = session?.queue.length ?? 0
  const progress = finished.length + remaining === 0 ? 1 : finished.length / (finished.length + remaining)
  const neededRetry = Object.keys(missedAt).length

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
                <span className="face-label">
                  {current.isNew ? 'New card' : missedAt[current.card.id] !== undefined ? 'Try again' : 'Question'}
                </span>
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
              <div className="ratings two">
                <button className="rating again" disabled={busy} onClick={() => void answer(Rating.DontKnow)}>
                  <span><Icon name="close" size={18} weight={2.8} />Don't know</span>
                  <small>Again in a moment</small>
                </button>
                <button className="rating good" disabled={busy} onClick={() => void answer(Rating.Know)}>
                  <span><Icon name="check" size={18} weight={2.8} />Know</span>
                  {/* When you'd see the card again */}
                  <small>Next in {formatInterval(schedule(current.state, Rating.Know, session.shownAt).dueAt - session.shownAt)}</small>
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary" style={{ height: 64 }} onClick={flip}>Show answer</button>
            )}
          </div>
        </>
      )}

      {session && !current && (
        <div className="done">
          <div className="done-badge"><Icon name="check" size={48} weight={3} /></div>
          <h2 style={{ fontSize: 28, fontWeight: 700 }}>All done for now!</h2>
          <p className="empty-text">
            {finished.length > 0 && `You went through ${finished.length} ${finished.length === 1 ? 'card' : 'cards'}`}
            {finished.length > 0 && (neededRetry > 0 ? `, ${neededRetry} of them took another try. ` : ', and knew every one. ')}
            {session.newLimitReached && `You've had today's ${NEW_CARDS_PER_DAY} new cards. `}
            {session.nextDueAt && `Next card is due ${formatWhen(session.nextDueAt)}.`}
          </p>
          <button className="btn btn-primary" style={{ marginTop: 24, maxWidth: 280 }} onClick={nav.back}>Done</button>
        </div>
      )}
    </div>
  )
}

// The next card to show: the first in the queue, skipping cards you just didn't
// know until a few others have been shown in between
function pickNext(queue: StudyCard[], missedAt: Record<string, number>, answered: number): StudyCard | undefined {
  return queue.find((c) => missedAt[c.card.id] === undefined || answered - missedAt[c.card.id] >= REPEAT_AFTER) ?? queue[0]
}
