// Statistics, computed from the review history on this device (which after a
// sync includes reviews from all your devices), so they work offline too.
import { getDB } from './db.ts'
import { studyDayKey, studyDayStart, studyDayStartDaysAgo } from './days.ts'
import { Rating } from '../../shared/srs.ts'

export const MATURE_DAYS = 21 // Anki calls a card "mature" once its interval is 3+ weeks

export interface Stats {
  cards: {
    total: number
    unseen: number   // never studied
    learning: number // seen, but not yet remembered a day later (or forgotten again)
    young: number    // interval under 3 weeks
    mature: number   // interval 3 weeks or more
  }
  today: {
    reviews: number      // answers given
    cards: number        // different cards studied
    newCards: number     // cards seen for the first time
    timeMs: number
    correctRate: number | null // share of answers that weren't "Again"
  }
  allTime: { reviews: number, timeMs: number, daysStudied: number }
  streakDays: number
  retention30d: number | null // of cards you'd seen before, how often you remembered them (last 30 days)
  last14Days: { day: string, reviews: number, again: number }[] // again = answers that were "Again" (forgotten)
  dueNext7Days: { day: string, cards: number }[] // today includes anything overdue
}

// deckId = null: all decks together
export async function getStats(deckId: string | null, now = Date.now()): Promise<Stats> {
  const db = await getDB()
  const cards = deckId ? await db.getAllFromIndex('cards', 'byDeck', deckId) : await db.getAll('cards')
  const cardIds = new Set(cards.map((c) => c.id))
  const reviews = (await db.getAll('reviews'))
    .filter((r) => cardIds.has(r.cardId))
    .sort((a, b) => a.reviewedAt - b.reviewedAt)

  const dayStart = studyDayStart(now)

  // ---- Cards by stage ----
  const counts = { total: cards.length, unseen: 0, learning: 0, young: 0, mature: 0 }
  const progress = new Map((await db.getAll('progress')).filter((p) => cardIds.has(p.cardId)).map((p) => [p.cardId, p]))
  for (const card of cards) {
    const p = progress.get(card.id)
    if (!p) counts.unseen++
    else if (p.intervalDays === 0) counts.learning++
    else if (p.intervalDays < MATURE_DAYS) counts.young++
    else counts.mature++
  }

  // ---- Reviews ----
  const firstSeen = new Map<string, number>()
  for (const r of reviews) if (!firstSeen.has(r.cardId)) firstSeen.set(r.cardId, r.reviewedAt)

  const todays = reviews.filter((r) => r.reviewedAt >= dayStart)
  const today = {
    reviews: todays.length,
    cards: new Set(todays.map((r) => r.cardId)).size,
    newCards: [...firstSeen.values()].filter((t) => t >= dayStart).length,
    timeMs: sum(todays.map((r) => r.durationMs ?? 0)),
    correctRate: todays.length ? todays.filter((r) => r.rating !== Rating.Again).length / todays.length : null,
  }

  const perDay = new Map<string, number>()
  const againPerDay = new Map<string, number>()
  for (const r of reviews) {
    const key = studyDayKey(r.reviewedAt)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
    if (r.rating === Rating.Again) againPerDay.set(key, (againPerDay.get(key) ?? 0) + 1)
  }

  // Streak: consecutive days with reviews, ending today (or yesterday, if you haven't studied yet today)
  let streakDays = 0
  for (let i = perDay.has(studyDayKey(now)) ? 0 : 1; perDay.has(studyDayKey(studyDayStartDaysAgo(now, i))); i++) {
    streakDays++
  }

  // Retention: answers on cards you'd already seen on an earlier day, in the last 30 days
  const since = studyDayStartDaysAgo(now, 30)
  const recall = reviews.filter((r) => r.reviewedAt >= since && studyDayKey(firstSeen.get(r.cardId)!) !== studyDayKey(r.reviewedAt))
  const retention30d = recall.length ? recall.filter((r) => r.rating !== Rating.Again).length / recall.length : null

  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const day = studyDayKey(studyDayStartDaysAgo(now, 13 - i))
    return { day, reviews: perDay.get(day) ?? 0, again: againPerDay.get(day) ?? 0 }
  })

  // ---- Forecast ----
  const dueNext7Days = Array.from({ length: 7 }, (_, i) => {
    const start = studyDayStartDaysAgo(now, -i)
    const end = studyDayStartDaysAgo(now, -i - 1)
    let n = 0
    for (const p of progress.values()) if ((i === 0 || p.dueAt >= start) && p.dueAt < end) n++
    return { day: studyDayKey(start), cards: n }
  })

  return {
    cards: counts,
    today,
    allTime: { reviews: reviews.length, timeMs: sum(reviews.map((r) => r.durationMs ?? 0)), daysStudied: perDay.size },
    streakDays,
    retention30d,
    last14Days,
    dueNext7Days,
  }
}

function sum(ns: number[]) {
  return ns.reduce((a, b) => a + b, 0)
}
