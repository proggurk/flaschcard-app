// Run with: npm run test:srs   (uses Node's built-in test runner)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  schedule, replay, newCardState, Rating, DAY_MS, INITIAL_EASE, MIN_EASE, type CardState,
} from './srs.ts'

const T0 = Date.UTC(2026, 0, 1)
const MIN = 60_000

// Answer `ratings` in order, each one when the card is due (or right away if it's due now)
function run(ratings: Rating[], start = newCardState(T0)) {
  let s = start
  let t = T0
  const intervals: number[] = []
  for (const r of ratings) {
    t = Math.max(t + MIN, s.dueAt)
    s = schedule(s, r, t)
    intervals.push(s.intervalDays)
  }
  return { state: s, intervals }
}

test('Know on a new card: 4 days', () => {
  const s = schedule(newCardState(T0), Rating.Know, T0)
  assert.equal(s.intervalDays, 4)
  assert.equal(s.dueAt, T0 + 4 * DAY_MS)
})

test('always knowing it: 4, 10, 25, 63 days', () => {
  const { state, intervals } = run([Rating.Know, Rating.Know, Rating.Know, Rating.Know])
  assert.deepEqual(intervals, [4, 10, 25, 63])
  assert.equal(state.ease, INITIAL_EASE)
})

test("Don't know keeps the card due right away, then Know means tomorrow", () => {
  const failed = schedule(newCardState(T0), Rating.DontKnow, T0)
  assert.equal(failed.dueAt, T0)
  assert.equal(failed.intervalDays, 0)
  const known = schedule(failed, Rating.Know, T0 + 2 * MIN)
  assert.equal(known.intervalDays, 1)
  assert.equal(known.dueAt, T0 + 2 * MIN + DAY_MS)
})

test("not knowing a card the first time you see it doesn't make it hard", () => {
  const s = schedule(newCardState(T0), Rating.DontKnow, T0)
  assert.equal(s.ease, INITIAL_EASE)
  assert.equal(s.lapses, 0)
})

test("every Don't know after that lowers the ease", () => {
  const { state } = run([Rating.DontKnow, Rating.DontKnow, Rating.DontKnow])
  assert.equal(state.ease, 2.1) // first view free, then -0.2 twice
})

test('forgetting a learned card is a lapse: back to tomorrow, then it grows again', () => {
  const { state, intervals } = run([Rating.Know, Rating.Know, Rating.DontKnow, Rating.Know, Rating.Know, Rating.Know])
  assert.deepEqual(intervals, [4, 10, 0, 1, 2, 5])
  assert.equal(state.lapses, 1)
  assert.equal(state.reps, 3)
})

test('hard cards grow more slowly than easy ones', () => {
  const easy = run([Rating.Know, Rating.Know, Rating.Know, Rating.Know])
  // Struggled at first: missed it three times before knowing it
  const hard = run([Rating.DontKnow, Rating.DontKnow, Rating.DontKnow, Rating.DontKnow, Rating.Know, Rating.Know, Rating.Know, Rating.Know])
  assert.ok(hard.state.dueAt - hard.state.lastReviewedAt! < easy.state.dueAt - easy.state.lastReviewedAt!)
  assert.ok(hard.state.ease < easy.state.ease)
})

test('each Know nudges the ease back up, never above the start', () => {
  const failed = run([Rating.Know, Rating.DontKnow]).state
  assert.equal(failed.ease, 2.3)
  const recovered = run([Rating.Know, Rating.Know, Rating.Know], failed).state
  assert.equal(recovered.ease, 2.45)
  const lots = run(Array(10).fill(Rating.Know), failed).state
  assert.equal(lots.ease, INITIAL_EASE)
})

test('ease never drops below the minimum, and known cards still grow by a day or more', () => {
  let s = schedule(newCardState(T0), Rating.Know, T0)
  for (let i = 0; i < 30; i++) s = schedule(s, Rating.DontKnow, T0 + i)
  assert.equal(s.ease, MIN_EASE)
  const { intervals } = run([Rating.Know, Rating.Know, Rating.Know], s)
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1])
})

test('ratings from the old four-button app still count: Hard and Easy as Know', () => {
  const s: CardState = { ...newCardState(T0), intervalDays: 10, reps: 2, lastReviewedAt: T0 }
  const know = schedule(s, Rating.Know, T0)
  assert.deepEqual(schedule(s, 2, T0), know)
  assert.deepEqual(schedule(s, 4, T0), know)
  assert.deepEqual(schedule(s, 1, T0), schedule(s, Rating.DontKnow, T0))
})

test('replay matches step-by-step scheduling (client == server)', () => {
  const history = [
    { rating: Rating.DontKnow, reviewedAt: T0 },
    { rating: Rating.Know, reviewedAt: T0 + 3 * MIN },
    { rating: Rating.Know, reviewedAt: T0 + 1 * DAY_MS },
    { rating: Rating.DontKnow, reviewedAt: T0 + 3 * DAY_MS },
    { rating: Rating.Know, reviewedAt: T0 + 3 * DAY_MS + 5 * MIN },
    { rating: 4 as const, reviewedAt: T0 + 5 * DAY_MS }, // an old "Easy"
  ]
  let s = newCardState(T0)
  for (const r of history) s = schedule(s, r.rating, r.reviewedAt)
  assert.deepEqual(replay(history), s)
})

test('replay of no reviews is null', () => {
  assert.equal(replay([]), null)
})
