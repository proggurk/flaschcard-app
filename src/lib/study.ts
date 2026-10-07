// Studying works entirely against the local database: no network needed.
import { getDB } from './db.ts'
import { syncSoon } from './sync.ts'
import { DAY_MS, studyDayStart } from './days.ts'
import { schedule, newCardState, type CardState, type Rating } from '../../shared/srs.ts'
import type { SyncCard, SyncDeck, SyncDeckUpload, SyncProgress } from '../../shared/sync-types.ts'
import { isReversed, notesWithSiblings } from './reverse.ts'

// No daily limits: you can study as much as you like. Studying happens in
// sessions of this many cards; afterwards you can start another one.
export const SESSION_SIZE = 20

export interface StudyCard {
  card: SyncCard
  state: CardState
  isNew: boolean
  reversed: boolean // mature: asked the other way round (answer side first)
}

export interface DeckSummary {
  deck: SyncDeck
  total: number
  new: number      // never studied
  learning: number // answered "Don't know", due again now
  due: number      // reviews due now
  nextDueAt: number | null // when the next not-yet-due card becomes due
}

export function toState(p: SyncProgress): CardState {
  return {
    dueAt: p.dueAt,
    intervalDays: p.intervalDays,
    ease: p.ease,
    reps: p.reps,
    lapses: p.lapses,
    lastReviewedAt: p.lastReviewedAt,
  }
}

async function loadDeck(deckId: string, now: number) {
  const db = await getDB()
  const cards = await db.getAllFromIndex('cards', 'byDeck', deckId)
  const learning: StudyCard[] = []
  const reviews: StudyCard[] = []
  const fresh: StudyCard[] = []
  let nextDueAt: number | null = null
  // Like Anki, a review card scheduled for some day is due all that day, not
  // from the exact minute. Re-learning cards ("Don't know") use the exact time.
  const endOfToday = studyDayStart(now) + DAY_MS
  const siblings = notesWithSiblings(cards)

  for (const card of cards) {
    const p = await db.get('progress', card.id)
    if (!p) {
      fresh.push({ card, state: newCardState(now), isNew: true, reversed: false })
      continue
    }
    const isLearning = p.intervalDays === 0
    if (p.dueAt <= (isLearning ? now : endOfToday)) {
      const state = toState(p)
      ;(isLearning ? learning : reviews).push({ card, state, isNew: false, reversed: isReversed(card, state, siblings) })
    } else {
      const becomesDue = isLearning ? p.dueAt : studyDayStart(p.dueAt)
      if (nextDueAt === null || becomesDue < nextDueAt) nextDueAt = becomesDue
    }
  }

  // New cards in the deck's own order (e.g. most common words first)
  fresh.sort((a, b) => (a.card.position ?? Infinity) - (b.card.position ?? Infinity) || a.card.id.localeCompare(b.card.id))
  // Most overdue first
  learning.sort((a, b) => a.state.dueAt - b.state.dueAt)
  reviews.sort((a, b) => a.state.dueAt - b.state.dueAt)

  return { total: cards.length, learning, reviews, fresh, nextDueAt }
}

// Every card you could study now, in order: cards you didn't know, then
// reviews, then new cards. A study session takes the first SESSION_SIZE.
export async function getStudyQueue(deckId: string, now = Date.now()) {
  const d = await loadDeck(deckId, now)
  return {
    queue: [...d.learning, ...d.reviews, ...d.fresh],
    nextDueAt: d.nextDueAt,
  }
}

export async function getDeckSummaries(now = Date.now()): Promise<DeckSummary[]> {
  const db = await getDB()
  const decks = await db.getAll('decks')
  // Decks created on this device that haven't been uploaded yet still show up
  for (const d of await db.getAll('outboxDecks')) {
    if (!decks.some((x) => x.id === d.id)) decks.push({ id: d.id, name: d.name, description: d.description })
  }
  return Promise.all(decks.map(async (deck) => {
    const d = await loadDeck(deck.id, now)
    return {
      deck,
      total: d.total,
      new: d.fresh.length,
      learning: d.learning.length,
      due: d.reviews.length,
      nextDueAt: d.nextDueAt,
    }
  }))
}

// Record an answer: update the card's schedule locally and queue the review for upload.
// `shownAt` is when the card appeared, to log how long the user thought about it
// (capped at a minute like Anki, so walking away from the app doesn't inflate study time).
export async function rateCard(cardId: string, rating: Rating, shownAt: number | null, now = Date.now()) {
  const durationMs = shownAt === null ? null : Math.min(60_000, Math.max(0, now - shownAt))
  const db = await getDB()
  const tx = db.transaction(['progress', 'reviews', 'outboxReviews'], 'readwrite')
  const current = await tx.objectStore('progress').get(cardId)
  const next = schedule(current ? toState(current) : newCardState(now), rating, now)

  const review = { id: crypto.randomUUID(), cardId, rating, durationMs, reviewedAt: now }
  await tx.objectStore('progress').put({ cardId, ...next })
  await tx.objectStore('reviews').add(review)
  await tx.objectStore('outboxReviews').add(review)
  await tx.done
  syncSoon()
}

const CARDS_PER_UPLOAD = 2000

// Save a deck (new or updated) on this device; it's uploaded on the next sync.
export async function saveDeck(deck: SyncDeckUpload) {
  const db = await getDB()
  const tx = db.transaction(['decks', 'cards', 'outboxDecks'], 'readwrite')
  await tx.objectStore('decks').put({ id: deck.id, name: deck.name, description: deck.description })
  for (const c of deck.cards) await tx.objectStore('cards').put({ ...c, deckId: deck.id })
  // Split big decks so each upload request stays a reasonable size
  for (let i = 0; i === 0 || i < deck.cards.length; i += CARDS_PER_UPLOAD) {
    await tx.objectStore('outboxDecks').add({ ...deck, cards: deck.cards.slice(i, i + CARDS_PER_UPLOAD) })
  }
  await tx.done
  syncSoon(500)
}

export async function createDeck(name: string, cards: { front: string, back: string }[]) {
  const id = crypto.randomUUID()
  await saveDeck({
    id,
    name,
    description: null,
    cards: cards.map((c, i) => ({ id: crypto.randomUUID(), front: c.front, back: c.back, ankiNoteId: null, position: i })),
  })
  return id
}
