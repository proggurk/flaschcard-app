// The app's local database (IndexedDB, built into the browser). Everything the
// UI shows is read from here, so the app works the same online and offline.
// The server is only talked to by sync.ts.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { SyncCard, SyncDeck, SyncDeckUpload, SyncExam, SyncProgress, SyncReview } from '../../shared/sync-types.ts'

export interface LocalUser {
  id: string
  email: string
  displayName: string | null
  username?: string | null // public name for friends/leaderboards
  showOnLeaderboard?: boolean
}

// A deck upload waiting in the outbox. Big decks are split into several of these.
export type OutboxDeck = SyncDeckUpload & { outboxId?: number }

export interface OutboxMedia {
  name: string // "<sha256>.<ext>"
  blob: Blob
}

interface FlashcardDB extends DBSchema {
  decks: { key: string, value: SyncDeck }
  cards: { key: string, value: SyncCard, indexes: { byDeck: string } }
  progress: { key: string, value: SyncProgress }
  // Every review ever made, from all devices (for statistics and daily limits)
  reviews: { key: string, value: SyncReview, indexes: { byCard: string, byTime: number } }
  exams: { key: string, value: SyncExam }
  // Outbox: changes made on this device that the server hasn't confirmed yet
  outboxDecks: { key: number, value: OutboxDeck }
  outboxReviews: { key: string, value: SyncReview, indexes: { byCard: string } }
  outboxMedia: { key: string, value: OutboxMedia }
  outboxExams: { key: string, value: SyncExam }
  meta: { key: string, value: unknown }
}

// Images/audio are kept in the browser's Cache Storage under their /api/media/... URL
export const MEDIA_CACHE = 'media'

let dbPromise: Promise<IDBPDatabase<FlashcardDB>> | null = null

export function getDB() {
  return (dbPromise ??= openDB<FlashcardDB>('flashcards', 4, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('decks', { keyPath: 'id' })
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('byDeck', 'deckId')
        db.createObjectStore('progress', { keyPath: 'cardId' })
        db.createObjectStore('outboxReviews', { keyPath: 'id' }).createIndex('byCard', 'cardId')
        db.createObjectStore('meta')
      }
      if (oldVersion < 2) {
        // v1 keyed outboxDecks by deck id; v2 uses an auto-increment key so a
        // big deck can be split into several uploads. Carry over anything pending.
        let pending: OutboxDeck[] = []
        if (oldVersion === 1) {
          // The v1 store had a string key; the typed schema only knows v2
          const old = tx.objectStore('outboxDecks' as never) as unknown as { getAll(): Promise<OutboxDeck[]> }
          pending = await old.getAll()
          db.deleteObjectStore('outboxDecks')
        }
        const store = db.createObjectStore('outboxDecks', { keyPath: 'outboxId', autoIncrement: true })
        for (const d of pending) await store.add(d)
        db.createObjectStore('outboxMedia', { keyPath: 'name' })
      }
      if (oldVersion < 3) {
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' })
        reviews.createIndex('byCard', 'cardId')
        reviews.createIndex('byTime', 'reviewedAt')
        if (oldVersion > 0) {
          for (const r of await tx.objectStore('outboxReviews').getAll()) await reviews.put(r)
          // Forget the sync position so the next sync downloads everything again,
          // including review history and card order, which older versions didn't keep
          await tx.objectStore('meta').delete('cursor')
        }
      }
      if (oldVersion < 4) {
        db.createObjectStore('exams', { keyPath: 'id' })
        db.createObjectStore('outboxExams', { keyPath: 'id' })
      }
    },
  }))
}

export async function getMeta<T>(key: 'user' | 'cursor' | 'lastSyncedAt'): Promise<T | undefined> {
  return (await getDB()).get('meta', key) as Promise<T | undefined>
}

export async function setMeta(key: 'user' | 'cursor' | 'lastSyncedAt', value: unknown) {
  await (await getDB()).put('meta', value, key)
}

// Wipes everything on this device (logout, or a different user logging in)
export async function clearLocalData() {
  const db = await getDB()
  const stores = ['decks', 'cards', 'progress', 'reviews', 'exams', 'outboxDecks', 'outboxReviews', 'outboxMedia', 'outboxExams', 'meta'] as const
  const tx = db.transaction(stores, 'readwrite')
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done])
  await caches.delete(MEDIA_CACHE)
}

export async function pendingCount(): Promise<number> {
  const db = await getDB()
  return (await db.count('outboxReviews')) + (await db.count('outboxDecks')) +
    (await db.count('outboxMedia')) + (await db.count('outboxExams'))
}
