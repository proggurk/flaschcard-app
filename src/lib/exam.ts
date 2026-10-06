// Exams: test yourself on cards you should know well (e.g. mature cards).
// Unlike studying, an exam doesn't change when cards are scheduled. At the end
// you can choose to send the cards you missed back to learning.
import { getDB } from './db.ts'
import { rateCard } from './study.ts'
import { syncSoon } from './sync.ts'
import { htmlToText } from './text.ts'
import { Rating } from '../../shared/srs.ts'
import type { SyncCard, SyncExam } from '../../shared/sync-types.ts'

export type ExamMode = 'choice' | 'self'

// Presets for "which cards": minimum interval in days
export const EXAM_LEVELS = [
  { minIntervalDays: 21, label: 'Mature cards (3+ weeks)' },
  { minIntervalDays: 7, label: 'Known for a week or more' },
  { minIntervalDays: 1, label: 'All cards learned so far' },
] as const

export interface ExamQuestion {
  card: SyncCard
  // Multiple choice: 4 options, one of them correct. Null when the card can't be
  // turned into multiple choice (e.g. an image-only answer): then it's self-graded.
  choices: string[] | null
  correctIndex: number
}

const MAX_CHOICE_LENGTH = 120 // longer answers don't work as buttons: self-grade those

async function eligibleCards(deckId: string | null, minIntervalDays: number) {
  const db = await getDB()
  const cards = deckId ? await db.getAllFromIndex('cards', 'byDeck', deckId) : await db.getAll('cards')
  const progress = new Map((await db.getAll('progress')).map((p) => [p.cardId, p]))
  return {
    all: cards,
    eligible: cards.filter((c) => {
      const p = progress.get(c.id)
      return p !== undefined && p.intervalDays >= Math.max(1, minIntervalDays)
    }),
  }
}

export async function countExamCards(deckId: string | null, minIntervalDays: number) {
  return (await eligibleCards(deckId, minIntervalDays)).eligible.length
}

export async function buildExam(
  deckId: string | null, minIntervalDays: number, size: number, mode: ExamMode, random = Math.random,
): Promise<ExamQuestion[]> {
  const { all, eligible } = await eligibleCards(deckId, minIntervalDays)
  const picked = shuffle(eligible, random).slice(0, size)

  // Wrong options come from other cards in the same deck (similar kind of answer)
  const answersByDeck = new Map<string, string[]>()
  for (const c of all) {
    const text = htmlToText(c.back)
    if (!text || text.length > MAX_CHOICE_LENGTH) continue
    const list = answersByDeck.get(c.deckId)
    if (list) list.push(text)
    else answersByDeck.set(c.deckId, [text])
  }

  return picked.map((card) => {
    const answer = htmlToText(card.back)
    if (mode === 'self' || !answer || answer.length > MAX_CHOICE_LENGTH) return { card, choices: null, correctIndex: -1 }

    const others = [...new Set(answersByDeck.get(card.deckId) ?? [])].filter((t) => t.toLowerCase() !== answer.toLowerCase())
    if (others.length < 3) return { card, choices: null, correctIndex: -1 } // not enough to choose from

    const choices = shuffle([answer, ...shuffle(others, random).slice(0, 3)], random)
    return { card, choices, correctIndex: choices.indexOf(answer) }
  })
}

export async function saveExamResult(exam: SyncExam) {
  const db = await getDB()
  const tx = db.transaction(['exams', 'outboxExams'], 'readwrite')
  await tx.objectStore('exams').put(exam)
  await tx.objectStore('outboxExams').put(exam)
  await tx.done
  syncSoon(500)
}

// Optional after an exam: treat missed cards as forgotten, so they're re-learned
export async function relearnCards(cardIds: string[]) {
  for (const id of cardIds) await rateCard(id, Rating.DontKnow, null)
}

export async function getExamHistory(deckId: string | null): Promise<SyncExam[]> {
  const db = await getDB()
  return (await db.getAll('exams'))
    .filter((e) => deckId === null || e.deckId === deckId)
    .sort((a, b) => b.finishedAt - a.finishedAt)
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
