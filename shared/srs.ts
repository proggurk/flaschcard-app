// Spaced repetition scheduling (a variant of SM-2, the algorithm Anki grew out of).
//
// This file is shared by the browser and the server. It must stay a pure,
// deterministic function: same state + rating + time in => same result out.
// The browser uses it to schedule cards offline; the server replays the full
// review history through it to get the authoritative state when syncing.

export const Rating = {
  Again: 1, // forgot it
  Hard: 2,  // remembered with difficulty
  Good: 3,  // remembered
  Easy: 4,  // trivial
} as const
export type Rating = (typeof Rating)[keyof typeof Rating]

export interface CardState {
  dueAt: number            // ms since epoch
  intervalDays: number     // 0 = new / relearning
  ease: number             // interval multiplier, starts at 2.5
  reps: number             // successful reviews in a row
  lapses: number           // times forgotten after being learned
  lastReviewedAt: number | null
}

export const DAY_MS = 24 * 60 * 60 * 1000
export const RELEARN_DELAY_MS = 10 * 60 * 1000 // "Again" shows the card again in 10 min
export const INITIAL_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_INTERVAL_DAYS = 36500

export function newCardState(now: number): CardState {
  return {
    dueAt: now,
    intervalDays: 0,
    ease: INITIAL_EASE,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
  }
}

export function isRating(n: number): n is Rating {
  return n === 1 || n === 2 || n === 3 || n === 4
}

export function schedule(state: CardState, rating: Rating, now: number): CardState {
  if (rating === Rating.Again) {
    return {
      dueAt: now + RELEARN_DELAY_MS,
      intervalDays: 0,
      ease: Math.max(MIN_EASE, state.ease - 0.2),
      reps: 0,
      // Only count a lapse if the card had actually been learned
      lapses: state.reps > 0 ? state.lapses + 1 : state.lapses,
      lastReviewedAt: now,
    }
  }

  const prev = state.intervalDays
  let interval: number

  if (state.reps === 0) {
    interval = rating === Rating.Easy ? 4 : 1
  } else if (state.reps === 1) {
    interval = { [Rating.Hard]: 2, [Rating.Good]: 6, [Rating.Easy]: 8 }[rating]
  } else {
    // Intervals are computed with the *old* ease, then ease is adjusted.
    // Each button is guaranteed to give a longer interval than the one before it.
    const hard = Math.max(prev + 1, Math.round(prev * 1.2))
    const good = Math.max(hard + 1, Math.round(prev * state.ease))
    const easy = Math.max(good + 1, Math.round(prev * state.ease * 1.3))
    interval = { [Rating.Hard]: hard, [Rating.Good]: good, [Rating.Easy]: easy }[rating]
  }

  interval = Math.min(interval, MAX_INTERVAL_DAYS)

  const easeDelta = { [Rating.Hard]: -0.15, [Rating.Good]: 0, [Rating.Easy]: 0.15 }[rating]

  return {
    dueAt: now + interval * DAY_MS,
    intervalDays: interval,
    ease: Math.max(MIN_EASE, round2(state.ease + easeDelta)),
    reps: state.reps + 1,
    lapses: state.lapses,
    lastReviewedAt: now,
  }
}

// Rebuild a card's state from its full review history (oldest first).
export function replay(reviews: { rating: Rating, reviewedAt: number }[]): CardState | null {
  if (reviews.length === 0) return null
  let state = newCardState(reviews[0].reviewedAt)
  for (const r of reviews) state = schedule(state, r.rating, r.reviewedAt)
  return state
}

// Avoid float drift (2.5 - 0.15 - 0.15 ...) so client and server compare cleanly
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
