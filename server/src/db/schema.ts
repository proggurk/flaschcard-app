import {
  pgTable, uuid, text, timestamp, integer, smallint, doublePrecision, boolean, jsonb, index, primaryKey, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// UUIDs instead of 1, 2, 3... so the app can create rows offline and sync later
// without id collisions.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  // Public name for friends and leaderboards (the email is never shown to others).
  // Lowercase, unique; null until the user picks one.
  username: text('username').unique(),
  // Opt-in: appear on the global leaderboard
  showOnLeaderboard: boolean('show_on_leaderboard').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// A friend request is a row with status 'pending'; accepting flips it to 'accepted'.
// One row per pair, stored in the direction it was requested.
export const friendships = pgTable('friendships', {
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.requesterId, t.addresseeId] }),
  index('friendships_addressee_idx').on(t.addresseeId),
  check('friendships_status', sql`${t.status} in ('pending', 'accepted')`),
  check('friendships_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
])

// One row per logged-in browser/device. The id is a SHA-256 hash of the token
// in the user's cookie, so a database leak doesn't hand out working logins.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sessions_user_id_idx').on(t.userId),
])

// updated_at columns below let a device ask "what changed since my last sync?"

export const decks = pgTable('decks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('decks_user_id_idx').on(t.userId),
])

export const cards = pgTable('cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  deckId: uuid('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  // "<Anki note guid>:<template ord>", so re-importing the same .apkg updates cards instead of duplicating them
  ankiNoteId: text('anki_note_id'),
  // Order new cards are introduced in (e.g. most common words first). Null = no particular order.
  position: integer('position'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('cards_deck_id_idx').on(t.deckId),
])

// The spaced-repetition state: one row per (user, card). Fields follow the SM-2 algorithm.
export const cardProgress = pgTable('card_progress', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId: uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
  intervalDays: integer('interval_days').notNull().default(0),
  // double precision (not real) so 2.35 stays 2.35 and client/server schedules match exactly
  ease: doublePrecision('ease').notNull().default(2.5),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.cardId] }),
  // Makes "which cards are due for this user right now?" fast
  index('card_progress_user_due_idx').on(t.userId, t.dueAt),
  index('card_progress_user_updated_idx').on(t.userId, t.updatedAt),
])

// Images/audio from Anki decks. The file itself lives in the object storage
// bucket under its SHA-256 hash (so identical files are stored once); this
// table records which users may read it.
export const media = pgTable('media', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // "<sha256>.<ext>"
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.name] }),
])

// Append-only log of every button press. This is the source of truth:
// card_progress is recomputed from it (see shared/srs.ts `replay`), which is
// what lets reviews from several offline devices merge without conflicts.
// The id is generated on the device, so re-sending a review is harmless.
export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId: uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  rating: smallint('rating').notNull(), // 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
  durationMs: integer('duration_ms'), // how long the user looked at the card
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  // When the server received it. Offline reviews arrive with old reviewed_at times,
  // so other devices ask "what arrived since my last sync?" using this instead.
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('reviews_user_reviewed_at_idx').on(t.userId, t.reviewedAt),
  index('reviews_user_synced_at_idx').on(t.userId, t.syncedAt),
  index('reviews_user_card_idx').on(t.userId, t.cardId),
  check('reviews_rating_range', sql`${t.rating} between 1 and 4`),
])

// A finished exam. Exams don't change scheduling by themselves, they're a record
// of how well you knew a set of cards. The id is generated on the device (offline).
export const exams = pgTable('exams', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deckId: uuid('deck_id').references(() => decks.id, { onDelete: 'set null' }), // null = all decks
  mode: text('mode').notNull(), // 'choice' (multiple choice) | 'self' (flip and self-grade)
  minIntervalDays: integer('min_interval_days').notNull(), // which cards were included
  total: integer('total').notNull(),
  correct: integer('correct').notNull(),
  answers: jsonb('answers').$type<{ cardId: string, correct: boolean }[]>().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('exams_user_synced_at_idx').on(t.userId, t.syncedAt),
  check('exams_score', sql`${t.correct} between 0 and ${t.total}`),
  check('exams_mode', sql`${t.mode} in ('choice', 'self')`),
])
