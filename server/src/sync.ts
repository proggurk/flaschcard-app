import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { and, eq, gt, inArray, asc, sql } from 'drizzle-orm'
import { db } from './db/index.ts'
import { decks, cards, cardProgress, reviews, exams } from './db/schema.ts'
import { requireAuth, type AuthEnv } from './auth/session.ts'
import { jsonBody } from './validate.ts'
import { replay, type Rating } from '../../shared/srs.ts'
import type { SyncResponse } from '../../shared/sync-types.ts'

// Rows changed slightly before the cursor might still have been committing
// when we read. Re-sending a few seconds of overlap is harmless because the
// app applies updates idempotently.
const CURSOR_OVERLAP = sql`interval '10 seconds'`
const CHUNK = 1000

const text = (max: number) => z.string().max(max)

const syncSchema = z.object({
  cursor: z.iso.datetime().nullable(),
  decks: z.array(z.object({
    id: z.uuid(),
    name: text(200).min(1),
    description: text(2000).nullable(),
    cards: z.array(z.object({
      id: z.uuid(),
      front: text(100_000),
      back: text(100_000),
      ankiNoteId: text(100).nullable(),
      position: z.number().int().min(0).nullable().default(null),
    })).max(50_000),
  })).max(20),
  reviews: z.array(z.object({
    id: z.uuid(),
    cardId: z.uuid(),
    rating: z.number().int().min(1).max(4),
    durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable(),
    reviewedAt: z.number().int().positive(),
  })).max(5000),
  exams: z.array(z.object({
    id: z.uuid(),
    deckId: z.uuid().nullable(),
    mode: z.enum(['choice', 'self']),
    minIntervalDays: z.number().int().min(0).max(36500),
    total: z.number().int().min(0).max(10_000),
    correct: z.number().int().min(0).max(10_000),
    answers: z.array(z.object({ cardId: z.uuid(), correct: z.boolean() })).max(10_000),
    startedAt: z.number().int().positive(),
    finishedAt: z.number().int().positive(),
  }).refine((e) => e.correct <= e.total, 'correct cannot exceed total')).max(100).default([]),
})

export const syncRoutes = new Hono<AuthEnv>()

syncRoutes.post('/', bodyLimit({ maxSize: 50 * 1024 * 1024 }), requireAuth, jsonBody(syncSchema), async (c) => {
  const userId = c.get('user').id
  const input = c.req.valid('json')

  const response = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ cursor: Date }>(sql`select now() - ${CURSOR_OVERLAP} as cursor`)
    const newCursor = new Date(rows[0].cursor).toISOString()

    // ---- 1. Push: decks and their cards -------------------------------------
    for (const deck of input.decks) {
      // Upsert, but never touch a deck that belongs to someone else
      const [owned] = await tx.insert(decks)
        .values({ id: deck.id, userId, name: deck.name, description: deck.description })
        .onConflictDoUpdate({
          target: decks.id,
          set: { name: deck.name, description: deck.description, updatedAt: sql`now()` },
          setWhere: eq(decks.userId, userId),
        })
        .returning({ id: decks.id })
      if (!owned) continue

      for (let i = 0; i < deck.cards.length; i += CHUNK) {
        await tx.insert(cards)
          .values(deck.cards.slice(i, i + CHUNK).map((card) => ({ ...card, deckId: deck.id })))
          .onConflictDoUpdate({
            target: cards.id,
            set: {
              front: sql`excluded.front`,
              back: sql`excluded.back`,
              ankiNoteId: sql`excluded.anki_note_id`,
              position: sql`excluded.position`,
              updatedAt: sql`now()`,
            },
            setWhere: eq(cards.deckId, deck.id),
          })
      }
    }

    // ---- 2. Push: reviews ---------------------------------------------------
    const rejectedReviewIds: string[] = []
    const touchedCardIds = new Set<string>()

    if (input.reviews.length > 0) {
      const requestedIds = [...new Set(input.reviews.map((r) => r.cardId))]
      const ownedCards = new Set<string>()
      for (let i = 0; i < requestedIds.length; i += CHUNK) {
        const found = await tx.select({ id: cards.id })
          .from(cards)
          .innerJoin(decks, eq(decks.id, cards.deckId))
          .where(and(eq(decks.userId, userId), inArray(cards.id, requestedIds.slice(i, i + CHUNK))))
        for (const row of found) ownedCards.add(row.id)
      }

      const maxTime = Date.now() + 60_000 // don't accept reviews from the future (bad device clock)
      const accepted = []
      for (const r of input.reviews) {
        if (!ownedCards.has(r.cardId)) { rejectedReviewIds.push(r.id); continue }
        accepted.push({
          id: r.id,
          userId,
          cardId: r.cardId,
          rating: r.rating,
          durationMs: r.durationMs,
          reviewedAt: new Date(Math.min(r.reviewedAt, maxTime)),
        })
        touchedCardIds.add(r.cardId)
      }

      for (let i = 0; i < accepted.length; i += CHUNK) {
        // Same review sent twice (e.g. the connection dropped after upload) is ignored
        await tx.insert(reviews).values(accepted.slice(i, i + CHUNK)).onConflictDoNothing()
      }
    }

    // ---- 3. Recompute progress from full history for every touched card -----
    const touched = [...touchedCardIds]
    for (let i = 0; i < touched.length; i += CHUNK) {
      const history = await tx.select({ cardId: reviews.cardId, rating: reviews.rating, reviewedAt: reviews.reviewedAt })
        .from(reviews)
        .where(and(eq(reviews.userId, userId), inArray(reviews.cardId, touched.slice(i, i + CHUNK))))
        .orderBy(asc(reviews.cardId), asc(reviews.reviewedAt), asc(reviews.id))

      const byCard = new Map<string, { rating: Rating, reviewedAt: number }[]>()
      for (const r of history) {
        let list = byCard.get(r.cardId)
        if (!list) byCard.set(r.cardId, list = [])
        list.push({ rating: r.rating as Rating, reviewedAt: r.reviewedAt.getTime() })
      }

      const rowsToUpsert = [...byCard].map(([cardId, list]) => {
        const s = replay(list)!
        return {
          userId,
          cardId,
          dueAt: new Date(s.dueAt),
          intervalDays: s.intervalDays,
          ease: s.ease,
          reps: s.reps,
          lapses: s.lapses,
          lastReviewedAt: s.lastReviewedAt === null ? null : new Date(s.lastReviewedAt),
        }
      })
      if (rowsToUpsert.length > 0) {
        await tx.insert(cardProgress).values(rowsToUpsert).onConflictDoUpdate({
          target: [cardProgress.userId, cardProgress.cardId],
          set: {
            dueAt: sql`excluded.due_at`,
            intervalDays: sql`excluded.interval_days`,
            ease: sql`excluded.ease`,
            reps: sql`excluded.reps`,
            lapses: sql`excluded.lapses`,
            lastReviewedAt: sql`excluded.last_reviewed_at`,
            updatedAt: sql`now()`,
          },
        })
      }
    }

    // ---- 3b. Push: finished exams -------------------------------------------
    if (input.exams.length > 0) {
      // Only keep the deck link if it's actually your deck
      const deckIds = [...new Set(input.exams.map((e) => e.deckId).filter((id): id is string => id !== null))]
      const ownDecks = new Set(deckIds.length === 0 ? [] : (await tx.select({ id: decks.id }).from(decks)
        .where(and(eq(decks.userId, userId), inArray(decks.id, deckIds)))).map((d) => d.id))

      await tx.insert(exams).values(input.exams.map((e) => ({
        ...e,
        userId,
        deckId: e.deckId && ownDecks.has(e.deckId) ? e.deckId : null,
        startedAt: new Date(e.startedAt),
        finishedAt: new Date(e.finishedAt),
      }))).onConflictDoNothing()
    }

    // ---- 4. Pull: everything that changed since the client's cursor ---------
    const since = input.cursor ? new Date(input.cursor) : null

    const deckRows = await tx.select({ id: decks.id, name: decks.name, description: decks.description })
      .from(decks)
      .where(and(eq(decks.userId, userId), since ? gt(decks.updatedAt, since) : undefined))

    const cardRows = await tx.select({
      id: cards.id, deckId: cards.deckId, front: cards.front, back: cards.back,
      ankiNoteId: cards.ankiNoteId, position: cards.position,
    })
      .from(cards)
      .innerJoin(decks, eq(decks.id, cards.deckId))
      .where(and(eq(decks.userId, userId), since ? gt(cards.updatedAt, since) : undefined))

    const progressRows = await tx.select().from(cardProgress)
      .where(and(eq(cardProgress.userId, userId), since ? gt(cardProgress.updatedAt, since) : undefined))

    const reviewRows = await tx.select({
      id: reviews.id, cardId: reviews.cardId, rating: reviews.rating,
      durationMs: reviews.durationMs, reviewedAt: reviews.reviewedAt,
    })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), since ? gt(reviews.syncedAt, since) : undefined))

    const examRows = await tx.select({
      id: exams.id, deckId: exams.deckId, mode: exams.mode, minIntervalDays: exams.minIntervalDays,
      total: exams.total, correct: exams.correct, answers: exams.answers,
      startedAt: exams.startedAt, finishedAt: exams.finishedAt,
    })
      .from(exams)
      .where(and(eq(exams.userId, userId), since ? gt(exams.syncedAt, since) : undefined))

    const result: SyncResponse = {
      cursor: newCursor,
      rejectedReviewIds,
      decks: deckRows,
      cards: cardRows,
      progress: progressRows.map((p) => ({
        cardId: p.cardId,
        dueAt: p.dueAt.getTime(),
        intervalDays: p.intervalDays,
        ease: p.ease,
        reps: p.reps,
        lapses: p.lapses,
        lastReviewedAt: p.lastReviewedAt?.getTime() ?? null,
      })),
      reviews: reviewRows.map((r) => ({ ...r, reviewedAt: r.reviewedAt.getTime() })),
      exams: examRows.map((e) => ({
        ...e,
        mode: e.mode as 'choice' | 'self',
        startedAt: e.startedAt.getTime(),
        finishedAt: e.finishedAt.getTime(),
      })),
    }
    return result
  })

  return c.json(response)
})
