// Friends and leaderboards. These need a connection (they're about other people),
// unlike studying which works offline.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, or, sql } from 'drizzle-orm'
import { db } from './db/index.ts'
import { friendships, users } from './db/schema.ts'
import { requireAuth, type AuthEnv } from './auth/session.ts'
import { createRateLimiter, tooManyRequests } from './auth/rate-limit.ts'
import { jsonBody } from './validate.ts'

export const socialRoutes = new Hono<AuthEnv>()
socialRoutes.use('*', requireAuth)

const hitFriendRequest = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 30 })

// ---- Friends ----------------------------------------------------------------

socialRoutes.get('/friends', async (c) => {
  const me = c.get('user').id
  const other = sql`case when ${friendships.requesterId} = ${me} then ${friendships.addresseeId} else ${friendships.requesterId} end`
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      status: friendships.status,
      sentByMe: sql<boolean>`${friendships.requesterId} = ${me}`,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, other))
    .where(or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)))
    .orderBy(users.username)

  const person = (r: typeof rows[number]) => ({ userId: r.userId, username: r.username, displayName: r.displayName })
  return c.json({
    friends: rows.filter((r) => r.status === 'accepted').map(person),
    incoming: rows.filter((r) => r.status === 'pending' && !r.sentByMe).map(person),
    outgoing: rows.filter((r) => r.status === 'pending' && r.sentByMe).map(person),
  })
})

// Send a friend request by username. If they already asked you, this accepts it.
socialRoutes.post('/friends/requests', jsonBody(z.object({ username: z.string().trim().toLowerCase().max(20) })), async (c) => {
  const me = c.get('user')
  if (!me.username) return c.json({ error: 'username_required' }, 400) // others need a name to see you by

  const wait = hitFriendRequest(me.id)
  if (wait !== null) return tooManyRequests(c, wait)

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.username, c.req.valid('json').username))
  if (!target) return c.json({ error: 'user_not_found' }, 404)
  if (target.id === me.id) return c.json({ error: 'cannot_add_yourself' }, 400)

  const [existing] = await db.select().from(friendships).where(or(
    and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, target.id)),
    and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, me.id)),
  ))

  if (existing?.status === 'accepted') return c.json({ status: 'accepted' })
  if (existing && existing.requesterId === target.id) {
    await db.update(friendships).set({ status: 'accepted' })
      .where(and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, me.id)))
    return c.json({ status: 'accepted' })
  }
  if (!existing) await db.insert(friendships).values({ requesterId: me.id, addresseeId: target.id })
  return c.json({ status: 'pending' }, 201)
})

socialRoutes.post('/friends/requests/:userId/accept', async (c) => {
  if (!z.uuid().safeParse(c.req.param('userId')).success) return c.json({ error: 'not_found' }, 404)
  const [row] = await db.update(friendships).set({ status: 'accepted' })
    .where(and(
      eq(friendships.requesterId, c.req.param('userId')),
      eq(friendships.addresseeId, c.get('user').id),
      eq(friendships.status, 'pending'),
    ))
    .returning({ status: friendships.status })
  return row ? c.json({ status: 'accepted' }) : c.json({ error: 'not_found' }, 404)
})

// Remove a friend, decline a request, or cancel one you sent
socialRoutes.delete('/friends/:userId', async (c) => {
  const me = c.get('user').id
  const other = c.req.param('userId')
  if (!z.uuid().safeParse(other).success) return c.json({ error: 'not_found' }, 404)
  await db.delete(friendships).where(or(
    and(eq(friendships.requesterId, me), eq(friendships.addresseeId, other)),
    and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me)),
  ))
  return c.json({ ok: true })
})

// ---- Leaderboard -------------------------------------------------------------

// Rolling windows instead of "this calendar week", so everyone's timezone is treated the same
const METRICS = {
  // Answers given in the last 7 days
  reviews7d: sql`(select count(*) from reviews r where r.user_id = u.id and r.reviewed_at > now() - interval '7 days')`,
  // Cards remembered for 3+ weeks
  mature: sql`(select count(*) from card_progress p where p.user_id = u.id and p.interval_days >= 21)`,
  // Days with at least one answer in the last 30 days
  days30d: sql`(select count(distinct date(r.reviewed_at)) from reviews r where r.user_id = u.id and r.reviewed_at > now() - interval '30 days')`,
}

const leaderboardQuery = z.object({
  scope: z.enum(['friends', 'global']).default('friends'),
  metric: z.enum(['reviews7d', 'mature', 'days30d']).default('reviews7d'),
})

socialRoutes.get('/leaderboard', async (c) => {
  const parsed = leaderboardQuery.safeParse(c.req.query())
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
  const { scope, metric } = parsed.data
  const me = c.get('user')

  // Who's on the board. You always see yourself, even if hidden from the global board.
  const members = scope === 'friends'
    ? sql`u.id = ${me.id} or u.id in (
        select case when f.requester_id = ${me.id} then f.addressee_id else f.requester_id end
        from friendships f
        where f.status = 'accepted' and (f.requester_id = ${me.id} or f.addressee_id = ${me.id}))`
    : sql`u.id = ${me.id} or (u.show_on_leaderboard and u.username is not null)`

  const { rows } = await db.execute<{ user_id: string, username: string | null, display_name: string | null, value: string, rank: string }>(sql`
    with board as (
      select u.id as user_id, u.username, u.display_name, ${METRICS[metric]} as value
      from users u
      where ${members}
    ), ranked as (
      select *, rank() over (order by value desc) as rank from board
    )
    select * from ranked
    where rank <= 50 or user_id = ${me.id}
    order by rank, username
  `)

  return c.json({
    scope,
    metric,
    hiddenFromGlobal: scope === 'global' && !(me.showOnLeaderboard && me.username),
    entries: rows.map((r) => ({
      rank: Number(r.rank),
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      value: Number(r.value),
      isMe: r.user_id === me.id,
    })),
  })
})
