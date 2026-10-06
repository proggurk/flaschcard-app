// Run with: npm test
// Daily limits, deck order and statistics, against an in-memory IndexedDB.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Rating } from '../../shared/srs.ts'

vi.mock('./sync.ts', () => ({ syncSoon: () => {} })) // no network in tests

let study: typeof import('./study.ts')
let stats: typeof import('./stats.ts')
let exam: typeof import('./exam.ts')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory() // fresh empty database per test
  vi.resetModules()
  study = await import('./study.ts')
  stats = await import('./stats.ts')
  exam = await import('./exam.ts')
})

const NOON = new Date(2026, 0, 10, 12, 0).getTime() // local noon, well inside a study day
const MIN = 60_000
const DAY = 24 * 60 * MIN

async function makeDeck(cardCount: number) {
  // Positions deliberately not in creation order
  const cards = Array.from({ length: cardCount }, (_, i) => ({ front: `Q${i}`, back: `A${i}` }))
  const deckId = await study.createDeck('Test', cards)
  return deckId
}

// Answer every card in the queue with `rating`, one second apart
async function studyAll(deckId: string, now: number, rating: Rating = Rating.Know) {
  const { queue } = await study.getStudyQueue(deckId, now)
  for (const [i, item] of queue.entries()) {
    await study.rateCard(item.card.id, rating, now + i * 1000, now + i * 1000 + 500)
  }
  return queue
}

describe('daily limits', () => {
  test('a day gives 20 new cards, in deck order', async () => {
    const deckId = await makeDeck(30)
    const { queue } = await study.getStudyQueue(deckId, NOON)
    expect(queue).toHaveLength(study.NEW_CARDS_PER_DAY)
    expect(queue.map((c) => c.card.front)).toEqual(Array.from({ length: 20 }, (_, i) => `Q${i}`))
  })

  test('after 20 new cards the deck is done for today', async () => {
    const deckId = await makeDeck(30)
    await studyAll(deckId, NOON)

    const later = await study.getStudyQueue(deckId, NOON + 60 * MIN)
    expect(later.queue).toHaveLength(0)
    expect(later.newLimitReached).toBe(true)

    const [summary] = await study.getDeckSummaries(NOON + 60 * MIN)
    expect(summary).toMatchObject({ new: 0, learning: 0, due: 0, unseen: 10, newLimitReached: true })
  })

  test("cards you don't know stay in the queue until known, without using up the limit", async () => {
    const deckId = await makeDeck(30)
    const { queue } = await study.getStudyQueue(deckId, NOON)
    await study.rateCard(queue[0].card.id, Rating.DontKnow, NOON, NOON + 1000)

    // Still due right away (it counts as one of today's 20 new cards): 1 to retry + 19 new
    const now = await study.getStudyQueue(deckId, NOON + 2000)
    expect(now.queue[0].card.front).toBe('Q0')
    expect(now.queue).toHaveLength(20)

    // Knowing it finishes it for today: due tomorrow
    await study.rateCard(queue[0].card.id, Rating.Know, NOON + 3000, NOON + 4000)
    const after = await study.getStudyQueue(deckId, NOON + 5000)
    expect(after.queue.map((c) => c.card.front)).not.toContain('Q0')
    expect(after.queue).toHaveLength(19)
    expect((await study.getStudyQueue(deckId, NOON + 1000 + 24 * 60 * MIN)).queue[0].card.front).toBe('Q0')
  })

  test('four days later brings reviews plus the next new cards', async () => {
    const deckId = await makeDeck(30)
    await studyAll(deckId, NOON) // 20 new cards answered "Know" => due in 4 days

    expect((await study.getStudyQueue(deckId, NOON + 3 * DAY)).queue.filter((c) => !c.isNew)).toHaveLength(0)
    const { queue } = await study.getStudyQueue(deckId, NOON + 4 * DAY)
    const reviews = queue.filter((c) => !c.isNew)
    const fresh = queue.filter((c) => c.isNew)
    expect(reviews).toHaveLength(20)
    expect(fresh.map((c) => c.card.front)).toEqual(Array.from({ length: 10 }, (_, i) => `Q${20 + i}`))
  })

  test('a study day starts at 4 am, like Anki', async () => {
    const deckId = await makeDeck(30)
    const lateNight = new Date(2026, 0, 10, 23, 0).getTime()
    await studyAll(deckId, lateNight)
    // 3 am the next calendar day is still the same study day: no new cards
    const threeAm = new Date(2026, 0, 11, 3, 0).getTime()
    expect((await study.getStudyQueue(deckId, threeAm)).queue.filter((c) => c.isNew)).toHaveLength(0)
  })
})

describe('statistics', () => {
  test('counts today\'s work, card stages and streak', async () => {
    const deckId = await makeDeck(30)
    // Day 1: 20 new cards known, then one of them forgotten (and left unfinished)
    const day1 = await studyAll(deckId, NOON - DAY)
    await study.rateCard(day1[0].card.id, Rating.DontKnow, null, NOON - DAY + 30 * MIN)
    // Day 2 (today): the forgotten card plus 10 new ones, all known
    await studyAll(deckId, NOON)

    const s = await stats.getStats(deckId, NOON + 60 * MIN)
    expect(s.cards).toEqual({ total: 30, unseen: 0, learning: 0, young: 30, mature: 0 })
    expect(s.today.newCards).toBe(10)
    expect(s.today.cards).toBe(11) // 1 relearned + 10 new
    expect(s.today.reviews).toBe(11)
    expect(s.today.correctRate).toBe(1)
    expect(s.streakDays).toBe(2)
    expect(s.allTime.reviews).toBe(20 + 1 + 11)
    expect(s.allTime.daysStudied).toBe(2)
    // Retention counts only cards seen on an earlier day: the relearned card, known
    expect(s.retention30d).toBe(1)
    expect(s.today.timeMs).toBe(11 * 500)
    // Yesterday had one "Don't know" out of 21 answers
    expect(s.last14Days.at(-2)).toMatchObject({ reviews: 21, forgot: 1 })
  })

  test('streak survives until you study today', async () => {
    const deckId = await makeDeck(5)
    await studyAll(deckId, NOON - DAY)
    expect((await stats.getStats(deckId, NOON)).streakDays).toBe(1)
    expect((await stats.getStats(deckId, NOON + 2 * DAY)).streakDays).toBe(0)
  })
})

describe('exams', () => {
  // Study "Know" every day for 15 days. Intervals go 4, 10, 25 days, so the
  // first 20 cards (started day 0) reach 25 days (mature) on day 14; the last
  // 10 (started day 1) would need day 15, so they're still young.
  async function deckWithHistory() {
    const deckId = await makeDeck(30)
    let t = NOON
    for (let day = 0; day < 15; day++) {
      t = NOON + day * DAY
      await studyAll(deckId, t)
    }
    return { deckId, now: t }
  }

  test('only includes cards above the chosen interval', async () => {
    const { deckId } = await deckWithHistory()
    const mature = await exam.countExamCards(deckId, 21)
    const learned = await exam.countExamCards(deckId, 1)
    expect(learned).toBe(30)
    expect(mature).toBe(20)

    const questions = await exam.buildExam(deckId, 21, 100, 'choice')
    expect(questions).toHaveLength(mature) // asked for 100, only `mature` qualify
  })

  test('multiple choice has 4 different options including the right answer', async () => {
    const { deckId } = await deckWithHistory()
    const questions = await exam.buildExam(deckId, 1, 10, 'choice')
    expect(questions).toHaveLength(10)
    for (const q of questions) {
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices).size).toBe(4)
      expect(q.choices![q.correctIndex]).toBe(q.card.back)
    }
  })

  test('self-graded mode has no options', async () => {
    const { deckId } = await deckWithHistory()
    const questions = await exam.buildExam(deckId, 1, 5, 'self')
    expect(questions.every((q) => q.choices === null)).toBe(true)
  })

  test('an exam does not change the schedule, unless you send missed cards back', async () => {
    const { deckId, now } = await deckWithHistory()
    const [q] = await exam.buildExam(deckId, 21, 1, 'choice')
    const db = await (await import('./db.ts')).getDB()
    const before = await db.get('progress', q.card.id)

    await exam.saveExamResult({
      id: crypto.randomUUID(), deckId, mode: 'choice', minIntervalDays: 21, total: 1, correct: 0,
      answers: [{ cardId: q.card.id, correct: false }], startedAt: now, finishedAt: now + 5000,
    })
    expect(await db.get('progress', q.card.id)).toEqual(before)
    expect((await exam.getExamHistory(deckId))[0].correct).toBe(0)

    await exam.relearnCards([q.card.id])
    const after = await db.get('progress', q.card.id)
    expect(after!.intervalDays).toBe(0) // back in learning
    expect(after!.lapses).toBe(before!.lapses + 1)
  })
})
