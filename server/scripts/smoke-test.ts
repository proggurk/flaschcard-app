// End-to-end test against a running server: `npm run dev` in one terminal,
// then `npm run test:api` in another. Creates a throwaway user and deletes it at the end.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { schedule, newCardState, Rating, DAY_MS, type CardState } from '../../shared/srs.ts'
import type { SyncRequest, SyncResponse } from '../../shared/sync-types.ts'

const BASE = process.env.API_URL ?? 'http://localhost:3000'

// A tiny "browser": remembers its session cookie
function device() {
  let cookie = ''
  // method 'PUT_RAW' sends `body` as raw bytes instead of JSON
  async function call(method: string, path: string, body?: unknown) {
    const raw = method === 'PUT_RAW'
    const res = await fetch(BASE + path, {
      method: raw ? 'PUT' : method,
      headers: { 'content-type': raw ? 'application/octet-stream' : 'application/json', ...(cookie && { cookie }) },
      body: body === undefined ? undefined : raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test script, responses are checked with asserts
    return { status: res.status, body: await res.json().catch(() => null) as any }
  }
  call.cookie = () => cookie
  return call
}

const step = (name: string) => console.log(`✔ ${name}`)

const email = `smoke-${randomUUID().slice(0, 8)}@example.com`
const password = 'correct horse battery staple'
const laptop = device()
const phone = device()

let created = false
try {
  // ---- Auth ----
  let r = await laptop('POST', '/api/auth/signup', { email, password: 'short' })
  assert.equal(r.status, 400); step('rejects short password')

  r = await laptop('POST', '/api/auth/signup', { email, password, displayName: 'Smoke' })
  assert.equal(r.status, 201); created = true; step('signup')

  r = await laptop('POST', '/api/auth/signup', { email: email.toUpperCase(), password })
  assert.equal(r.status, 409); step('duplicate email (case-insensitive) rejected')

  r = await laptop('GET', '/api/auth/me')
  assert.equal(r.body.user.email, email); step('/me returns the user')

  r = await phone('GET', '/api/auth/me')
  assert.equal(r.status, 401); step('/me without session is 401')

  r = await phone('POST', '/api/auth/login', { email, password: 'wrong password!' })
  assert.equal(r.status, 401); step('wrong password rejected')

  r = await phone('POST', '/api/auth/login', { email, password })
  assert.equal(r.status, 200); step('login on second device')

  // ---- Laptop creates a deck (as if imported offline) ----
  const deckId = randomUUID()
  const cardA = randomUUID(), cardB = randomUUID()
  const upload: SyncRequest = {
    cursor: null,
    decks: [{ id: deckId, name: 'Smoke deck', description: null, cards: [
      { id: cardA, front: 'Hej', back: 'Hello', ankiNoteId: null, position: 0 },
      { id: cardB, front: 'Tack', back: 'Thanks', ankiNoteId: null, position: 1 },
    ] }],
    reviews: [],
  }
  r = await laptop('POST', '/api/sync', upload)
  assert.equal(r.status, 200)
  const laptopCursor = (r.body as SyncResponse).cursor
  step('deck upload')

  // ---- Phone pulls it ----
  r = await phone('POST', '/api/sync', { cursor: null, decks: [], reviews: [] })
  let phoneSync = r.body as SyncResponse
  assert.equal(phoneSync.decks.length, 1)
  assert.equal(phoneSync.cards.length, 2)
  assert.equal(phoneSync.cards.find((c) => c.id === cardB)!.position, 1)
  step('second device receives the deck (with card order)')

  // ---- Both study card A "offline", interleaved in time ----
  const t0 = Date.now() - 10 * DAY_MS
  const laptopReviews = [
    { id: randomUUID(), cardId: cardA, rating: Rating.Know, durationMs: 3000, reviewedAt: t0 },
    { id: randomUUID(), cardId: cardA, rating: Rating.Know, durationMs: 2000, reviewedAt: t0 + 2 * DAY_MS },
  ]
  const phoneReviews = [
    { id: randomUUID(), cardId: cardA, rating: Rating.DontKnow, durationMs: 5000, reviewedAt: t0 + 1 * DAY_MS },
    // A phone still running the old four-button app sends "Hard" (2): must still be accepted
    { id: randomUUID(), cardId: cardA, rating: 2 as const, durationMs: 4000, reviewedAt: t0 + 1 * DAY_MS + 60_000 },
  ]
  const foreignReview = { id: randomUUID(), cardId: randomUUID(), rating: Rating.Know, durationMs: null, reviewedAt: t0 }

  // What the merged history *should* produce, in time order
  let expected: CardState = newCardState(t0)
  for (const rv of [...laptopReviews, ...phoneReviews].sort((a, b) => a.reviewedAt - b.reviewedAt)) {
    expected = schedule(expected, rv.rating, rv.reviewedAt)
  }

  r = await phone('POST', '/api/sync', { cursor: phoneSync.cursor, decks: [], reviews: [...phoneReviews, foreignReview] })
  phoneSync = r.body as SyncResponse
  assert.deepEqual(phoneSync.rejectedReviewIds, [foreignReview.id])
  step('review for a card you don\'t own is rejected')

  r = await laptop('POST', '/api/sync', { cursor: laptopCursor, decks: [], reviews: laptopReviews })
  const laptopSync = r.body as SyncResponse
  const progressA = laptopSync.progress.find((p) => p.cardId === cardA)!
  assert.equal(progressA.dueAt, expected.dueAt)
  assert.equal(progressA.intervalDays, expected.intervalDays)
  assert.equal(progressA.ease, expected.ease)
  assert.equal(progressA.reps, expected.reps)
  step(`offline reviews from two devices merge correctly (interval ${expected.intervalDays}d, ease ${expected.ease})`)

  // ---- Re-sending the same reviews (e.g. dropped connection) changes nothing ----
  r = await laptop('POST', '/api/sync', { cursor: laptopSync.cursor, decks: [], reviews: laptopReviews })
  const again = (r.body as SyncResponse).progress.find((p) => p.cardId === cardA)!
  assert.equal(again.reps, expected.reps)
  assert.equal(again.dueAt, expected.dueAt)
  step('duplicate upload is idempotent')

  // ---- Phone catches up ----
  r = await phone('POST', '/api/sync', { cursor: phoneSync.cursor, decks: [], reviews: [] })
  const phoneCatchUp = r.body as SyncResponse
  const phoneA = phoneCatchUp.progress.find((p) => p.cardId === cardA)!
  assert.equal(phoneA.dueAt, expected.dueAt)
  step('second device pulls merged progress')

  // The laptop's reviews were made "10 days ago" but only just uploaded: the
  // phone must still receive them (for statistics)
  // (It may also get its own recent review back: the sync overlap window makes that harmless)
  const received = new Set(phoneCatchUp.reviews.map((rv) => rv.id))
  assert.ok(laptopReviews.every((rv) => received.has(rv.id)))
  step('second device receives review history from the other device')

  // ---- Another user can't see or hijack the deck ----
  const stranger = device()
  const strangerEmail = `smoke-${randomUUID().slice(0, 8)}@example.com`
  await stranger('POST', '/api/auth/signup', { email: strangerEmail, password })
  r = await stranger('POST', '/api/sync', {
    cursor: null,
    decks: [{ id: deckId, name: 'hijacked', description: null, cards: [{ id: cardA, front: 'x', back: 'x', ankiNoteId: null }] }],
    reviews: [],
  })
  assert.equal(r.body.decks.length, 0)
  assert.equal(r.body.cards.length, 0)
  r = await laptop('POST', '/api/sync', { cursor: null, decks: [], reviews: [] })
  assert.equal(r.body.decks[0].name, 'Smoke deck')
  assert.equal(r.body.cards.find((c: { id: string }) => c.id === cardA).front, 'Hej')
  await stranger('DELETE', '/api/auth/account', { password })
  step('other users cannot read or overwrite your deck')

  // ---- Media (images/audio) ----
  const bytes = new TextEncoder().encode(`fake image ${randomUUID()}`)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const put = (who: typeof laptop, name: string, body: Uint8Array) => who('PUT_RAW', `/api/media/${name}`, body)

  r = await put(laptop, `${'0'.repeat(64)}.png`, bytes)
  assert.equal(r.status, 400); step('media with wrong hash rejected')
  r = await put(laptop, `${hash}.exe`, bytes)
  assert.equal(r.status, 415); step('unsupported media type rejected')
  r = await put(laptop, `${hash}.png`, bytes)
  assert.equal(r.status, 200); step('media upload to bucket')

  const res = await fetch(`${BASE}/api/media/${hash}.png`, { headers: { cookie: laptop.cookie() } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes)
  step('media download returns the same bytes')

  const nosy = device()
  await nosy('POST', '/api/auth/signup', { email: `smoke-${randomUUID().slice(0, 8)}@example.com`, password })
  r = await nosy('GET', `/api/media/${hash}.png`)
  assert.equal(r.status, 404)
  await nosy('DELETE', '/api/auth/account', { password })
  step('other users cannot download your media')

  // ---- Exams ----
  const examId = randomUUID()
  r = await laptop('POST', '/api/sync', {
    cursor: null, decks: [], reviews: [],
    exams: [{
      id: examId, deckId, mode: 'choice', minIntervalDays: 21, total: 2, correct: 1,
      answers: [{ cardId: cardA, correct: true }, { cardId: cardB, correct: false }],
      startedAt: Date.now() - 60_000, finishedAt: Date.now(),
    }],
  })
  assert.equal(r.status, 200)
  r = await phone('POST', '/api/sync', { cursor: null, decks: [], reviews: [] })
  const exam = (r.body as SyncResponse).exams.find((e) => e.id === examId)!
  assert.equal(exam.correct, 1)
  assert.equal(exam.deckId, deckId)
  step('exam results sync to other devices')

  // ---- Friends & leaderboard ----
  const friend = device()
  await friend('POST', '/api/auth/signup', { email: `smoke-${randomUUID().slice(0, 8)}@example.com`, password })
  const myName = `smoke_${randomUUID().slice(0, 8)}`
  const friendName = `smoke_${randomUUID().slice(0, 8)}`

  r = await laptop('POST', '/api/social/friends/requests', { username: friendName })
  assert.equal(r.status, 400); step('need a username before adding friends')

  r = await laptop('PATCH', '/api/auth/profile', { username: 'No Spaces!' })
  assert.equal(r.status, 400); step('invalid username rejected')

  r = await laptop('PATCH', '/api/auth/profile', { username: myName.toUpperCase() })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.username, myName); step('username set (stored lowercase)')

  r = await friend('PATCH', '/api/auth/profile', { username: myName })
  assert.equal(r.status, 409); step('username already taken')
  await friend('PATCH', '/api/auth/profile', { username: friendName })

  r = await laptop('POST', '/api/social/friends/requests', { username: friendName })
  assert.equal(r.status, 201)
  r = await friend('GET', '/api/social/friends')
  assert.equal(r.body.incoming[0].username, myName)
  assert.equal(JSON.stringify(r.body).includes('@'), false) // emails never exposed
  step('friend request arrives (without exposing email)')

  r = await friend('POST', `/api/social/friends/requests/${r.body.incoming[0].userId}/accept`)
  assert.equal(r.status, 200)
  r = await laptop('GET', '/api/social/friends')
  assert.equal(r.body.friends[0].username, friendName)
  step('friend request accepted')

  // One fresh review so the 7-day board has something to rank
  await laptop('POST', '/api/sync', { cursor: null, decks: [], reviews: [
    { id: randomUUID(), cardId: cardB, rating: Rating.Know, durationMs: 1000, reviewedAt: Date.now() },
  ] })
  r = await friend('GET', '/api/social/leaderboard?scope=friends&metric=reviews7d')
  assert.deepEqual(r.body.entries.map((e: { username: string, value: number }) => [e.username, e.value]), [[myName, 1], [friendName, 0]])
  step('friends leaderboard ranks friends')

  r = await laptop('GET', '/api/social/leaderboard?scope=global')
  assert.equal(r.body.hiddenFromGlobal, true)
  assert.equal(r.body.entries.some((e: { username: string }) => e.username === friendName), false)
  step('global leaderboard is opt-in')

  await friend('PATCH', '/api/auth/profile', { showOnLeaderboard: true })
  r = await laptop('GET', '/api/social/leaderboard?scope=global')
  assert.equal(r.body.entries.some((e: { username: string }) => e.username === friendName), true)
  step('opted-in users appear on the global leaderboard')

  r = await friend('DELETE', `/api/social/friends/${(await laptop('GET', '/api/auth/me')).body.user.id}`)
  r = await laptop('GET', '/api/social/friends')
  assert.equal(r.body.friends.length, 0)
  await friend('DELETE', '/api/auth/account', { password })
  step('removing a friend')

  // ---- Logout ----
  r = await phone('POST', '/api/auth/logout')
  assert.equal(r.status, 200)
  r = await phone('GET', '/api/auth/me')
  assert.equal(r.status, 401)
  step('logout ends the session')

  console.log('\nAll API checks passed.')
} finally {
  if (created) {
    const r = await laptop('DELETE', '/api/auth/account', { password })
    console.log(r.status === 200 ? '(test user deleted)' : `!! could not delete test user ${email}`)
  }
}
