// Spaced repetition scheduling: two answers, Know and Don't know (a variant of
// SM-2, the algorithm Anki grew out of).
//
//   - Know on a brand-new card: see it again in 4 days.
//   - Don't know: the card stays due until you know it (the study session
//     brings it back after a few other cards). Then: tomorrow.
//   - Know on a learned card: previous interval x the card's ease, so with the
//     starting ease of 2.5 you get 4 -> 10 -> 25 -> 63 days...
//   - Ease is how fast a card grows. Each Don't know lowers it (the card is hard
//     for you); each Know nudges it back up a little.
//
// This file is shared by the browser and the server. It must stay a pure,
// deterministic function: same state + rating + time in => same result out.
// The browser uses it to schedule cards offline; the server replays the full
// review history through it to get the authoritative state when syncing.

export const Rating = {
  DontKnow: 1,
  Know: 3,
} as const
// Stored as numbers. Older versions of the app had four buttons: 1 Again, 2 Hard,
// 3 Good, 4 Easy. Their reviews are still in everyone's history, so 2 and 4 stay
// valid and count as Know (only 1 meant "forgot").
export type Rating = 1 | 2 | 3 | 4

export const knew = (rating: number) => rating !== Rating.DontKnow

export interface CardState {
  dueAt: number            // ms since epoch
  intervalDays: number     // 0 = new / not known yet
  ease: number             // interval multiplier, starts at 2.5
  reps: number             // Knows in a row
  lapses: number           // times forgotten after being learned
  lastReviewedAt: number | null
}

export const DAY_MS = 24 * 60 * 60 * 1000
export const FIRST_KNOW_DAYS = 4   // Know the first time you see a card
export const RELEARNED_DAYS = 1    // Know after a Don't know
export const INITIAL_EASE = 2.5    // also the most a card's ease recovers to
export const MIN_EASE = 1.3
export const EASE_PENALTY = 0.2    // per Don't know
export const EASE_RECOVERY = 0.05  // per Know
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
  if (!knew(rating)) {
    // Not knowing a card the very first time you see it says nothing about
    // how hard it is; after that, every Don't know counts against it.
    const firstView = state.lastReviewedAt === null
    return {
      dueAt: now, // stays due until you know it
      intervalDays: 0,
      ease: firstView ? state.ease : Math.max(MIN_EASE, round2(state.ease - EASE_PENALTY)),
      reps: 0,
      // Only count a lapse if the card had actually been learned
      lapses: state.reps > 0 ? state.lapses + 1 : state.lapses,
      lastReviewedAt: now,
    }
  }

  let interval: number
  if (state.intervalDays === 0) {
    // Not learned yet: known straight away, or known after not knowing it
    interval = state.lastReviewedAt === null ? FIRST_KNOW_DAYS : RELEARNED_DAYS
  } else {
    // Computed with the current ease, then ease is adjusted. Always at least a day longer.
    interval = Math.max(state.intervalDays + 1, Math.round(state.intervalDays * state.ease))
  }
  interval = Math.min(interval, MAX_INTERVAL_DAYS)

  return {
    dueAt: now + interval * DAY_MS,
    intervalDays: interval,
    ease: Math.min(INITIAL_EASE, round2(state.ease + EASE_RECOVERY)),
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

// Avoid float drift (2.5 - 0.2 + 0.05 ...) so client and server compare cleanly
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
