// Run with: npm run test:srs   (uses Node's built-in test runner)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  schedule, replay, newCardState, Rating, DAY_MS, RELEARN_DELAY_MS, MIN_EASE, type CardState,
} from './srs.ts'

const T0 = Date.UTC(2026, 0, 1)

test('new card: Good -> 1 day, Easy -> 4 days, Again -> 10 minutes', () => {
  const s = newCardState(T0)
  assert.equal(schedule(s, Rating.Good, T0).dueAt, T0 + DAY_MS)
  assert.equal(schedule(s, Rating.Easy, T0).dueAt, T0 + 4 * DAY_MS)
  assert.equal(schedule(s, Rating.Again, T0).dueAt, T0 + RELEARN_DELAY_MS)
})

test('classic SM-2 progression with Good: 1, 6, 15, 38 days', () => {
  let s = newCardState(T0)
  let t = T0
  const intervals: number[] = []
  for (let i = 0; i < 4; i++) {
    s = schedule(s, Rating.Good, t)
    intervals.push(s.intervalDays)
    t = s.dueAt
  }
  assert.deepEqual(intervals, [1, 6, 15, 38])
  assert.equal(s.ease, 2.5)
})

test('buttons always order Hard < Good < Easy', () => {
  for (const reps of [0, 1, 2, 5]) {
    for (const ease of [MIN_EASE, 2.5, 3.2]) {
      const s: CardState = { ...newCardState(T0), reps, ease, intervalDays: reps === 0 ? 0 : 3 }
      const hard = schedule(s, Rating.Hard, T0).intervalDays
      const good = schedule(s, Rating.Good, T0).intervalDays
      const easy = schedule(s, Rating.Easy, T0).intervalDays
      assert.ok(hard <= good && good < easy, `reps=${reps} ease=${ease}: ${hard} ${good} ${easy}`)
      if (reps >= 1) assert.ok(hard < good, `reps=${reps} ease=${ease}`)
    }
  }
})

test('Again on a learned card is a lapse and resets reps', () => {
  let s = schedule(newCardState(T0), Rating.Good, T0)
  s = schedule(s, Rating.Good, s.dueAt)
  const lapsed = schedule(s, Rating.Again, s.dueAt)
  assert.equal(lapsed.lapses, 1)
  assert.equal(lapsed.reps, 0)
  assert.equal(lapsed.intervalDays, 0)
  assert.equal(lapsed.ease, 2.3)
})

test('Again on a brand new card is not a lapse', () => {
  const s = schedule(newCardState(T0), Rating.Again, T0)
  assert.equal(s.lapses, 0)
})

test('ease never drops below the minimum', () => {
  let s = newCardState(T0)
  for (let i = 0; i < 30; i++) s = schedule(s, Rating.Again, T0)
  assert.equal(s.ease, MIN_EASE)
})

test('replay matches step-by-step scheduling (client == server)', () => {
  const history = [
    { rating: Rating.Good, reviewedAt: T0 },
    { rating: Rating.Hard, reviewedAt: T0 + 1 * DAY_MS },
    { rating: Rating.Again, reviewedAt: T0 + 3 * DAY_MS },
    { rating: Rating.Good, reviewedAt: T0 + 3 * DAY_MS + RELEARN_DELAY_MS },
    { rating: Rating.Easy, reviewedAt: T0 + 5 * DAY_MS },
  ]
  let s = newCardState(T0)
  for (const r of history) s = schedule(s, r.rating, r.reviewedAt)
  assert.deepEqual(replay(history), s)
})

test('replay of no reviews is null', () => {
  assert.equal(replay([]), null)
})
