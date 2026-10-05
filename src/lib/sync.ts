// Two-way sync between IndexedDB and the server.
//   push: decks + reviews waiting in the outbox
//   pull: everything that changed on the server since our last cursor
// Safe to call any time; if offline it just does nothing and tries later.
import { api, OfflineError } from './api.ts'
import { getDB, getMeta, setMeta } from './db.ts'
import type { SyncRequest, SyncResponse } from '../../shared/sync-types.ts'

export type SyncResult = 'ok' | 'offline' | 'unauthenticated' | 'error'

const MAX_REVIEWS_PER_REQUEST = 2000
const MAX_DECKS_PER_REQUEST = 1 // each outbox entry already holds up to 2000 cards
const MAX_EXAMS_PER_REQUEST = 50

let running: Promise<SyncResult> | null = null
const listeners = new Set<(result: SyncResult) => void>()

// UI can subscribe to re-render after a sync finishes
export function onSynced(fn: (result: SyncResult) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function sync(): Promise<SyncResult> {
  // If a sync is already running, share it instead of starting a second one
  return (running ??= runSync().then((result) => {
    running = null
    listeners.forEach((fn) => fn(result))
    return result
  }))
}

async function runSync(): Promise<SyncResult> {
  if (!navigator.onLine) return 'offline'
  try {
    // Loop until the outbox is empty (big backlogs go in several requests)
    for (;;) {
      const more = await syncOnce()
      if (!more) break
    }
    await uploadMedia()
    await setMeta('lastSyncedAt', Date.now())
    return 'ok'
  } catch (err) {
    if (err instanceof OfflineError) return 'offline'
    if (err instanceof UnauthenticatedError) return 'unauthenticated'
    console.error('sync failed', err)
    return 'error'
  }
}

class UnauthenticatedError extends Error {}

// Returns true if there's more in the outbox to send
async function syncOnce(): Promise<boolean> {
  const db = await getDB()
  const cursor = (await getMeta<string>('cursor')) ?? null
  const decks = await db.getAll('outboxDecks', undefined, MAX_DECKS_PER_REQUEST)
  const reviews = await db.getAll('outboxReviews', undefined, MAX_REVIEWS_PER_REQUEST)
  const exams = await db.getAll('outboxExams', undefined, MAX_EXAMS_PER_REQUEST)

  const body: SyncRequest = {
    cursor,
    decks: decks.map((d) => ({ id: d.id, name: d.name, description: d.description, cards: d.cards })),
    reviews,
    exams,
  }
  const res = await api<SyncResponse>('POST', '/sync', body)
  if (res.status === 401) throw new UnauthenticatedError()
  if (!res.ok) throw new Error(`sync failed with status ${res.status}`)
  const data = res.data

  const tx = db.transaction(
    ['decks', 'cards', 'progress', 'reviews', 'exams', 'outboxDecks', 'outboxReviews', 'outboxExams', 'meta'],
    'readwrite',
  )

  // The server has these now (rejected reviews are dropped too: they can never succeed)
  for (const d of decks) await tx.objectStore('outboxDecks').delete(d.outboxId!)
  for (const r of reviews) await tx.objectStore('outboxReviews').delete(r.id)
  for (const e of exams) await tx.objectStore('outboxExams').delete(e.id)
  for (const id of data.rejectedReviewIds) await tx.objectStore('reviews').delete(id)

  for (const d of data.decks) await tx.objectStore('decks').put(d)
  for (const c of data.cards) await tx.objectStore('cards').put(c)
  for (const r of data.reviews) await tx.objectStore('reviews').put(r)
  for (const e of data.exams ?? []) await tx.objectStore('exams').put(e)

  for (const p of data.progress) {
    // If the user reviewed this card again while we were syncing, the local
    // state is newer than the server's: keep it, it'll be pushed next time.
    const pending = await tx.objectStore('outboxReviews').index('byCard').count(p.cardId)
    if (pending === 0) await tx.objectStore('progress').put(p)
  }

  await tx.objectStore('meta').put(data.cursor, 'cursor')
  await tx.done

  return decks.length === MAX_DECKS_PER_REQUEST || reviews.length === MAX_REVIEWS_PER_REQUEST ||
    exams.length === MAX_EXAMS_PER_REQUEST
}

// Images/audio go up one at a time, outside the main sync request
async function uploadMedia() {
  const db = await getDB()
  for (const name of await db.getAllKeys('outboxMedia')) {
    const item = await db.get('outboxMedia', name)
    if (!item) continue
    let res: Response
    try {
      res = await fetch(`/api/media/${name}`, { method: 'PUT', body: item.blob, credentials: 'same-origin' })
    } catch {
      throw new OfflineError()
    }
    if (res.status === 401) throw new UnauthenticatedError()
    if (res.status === 429 || res.status >= 500) throw new Error(`media upload failed with status ${res.status}`)
    // 4xx other than the above (too large, unsupported type) will never succeed: drop it
    if (!res.ok) console.warn(`media ${name} rejected with status ${res.status}`)
    await db.delete('outboxMedia', name)
  }
}

// Debounced sync after each review, so rapid-fire studying doesn't spam the server
let timer: ReturnType<typeof setTimeout> | undefined
export function syncSoon(delayMs = 3000) {
  clearTimeout(timer)
  timer = setTimeout(() => { void sync() }, delayMs)
}

// Call once at startup: sync when the connection returns, when the app is
// hidden (user switches app/tab), and every few minutes.
export function startBackgroundSync() {
  const onOnline = () => { void sync() }
  const onHidden = () => { if (document.visibilityState === 'hidden') void sync() }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onHidden)
  const interval = setInterval(() => { void sync() }, 5 * 60 * 1000)
  void sync()
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onHidden)
    clearInterval(interval)
  }
}
