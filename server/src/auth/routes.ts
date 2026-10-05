import { Hono } from 'hono'
import { z } from 'zod'
import { hash, verify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { jsonBody } from '../validate.ts'
import { deleteCookie } from 'hono/cookie'
import { createSession, destroySession, requireAuth, userFields, SESSION_COOKIE, type AuthEnv } from './session.ts'
import { createRateLimiter, rateLimitByIp, tooManyRequests } from './rate-limit.ts'

// OWASP-recommended argon2id settings (19 MiB memory, 2 passes)
const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254))

const signupSchema = z.object({
  email,
  password: z.string().min(8, 'must be at least 8 characters').max(256),
  displayName: z.string().trim().min(1).max(50).optional(),
})
const loginSchema = z.object({ email, password: z.string().min(1).max(256) })

// Used when the email doesn't exist, so a failed login takes the same time
// either way and nobody can probe which emails have accounts.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hash('not-a-real-password', ARGON2_OPTS))

const FIFTEEN_MIN = 15 * 60 * 1000
const limitByIp = rateLimitByIp({ windowMs: FIFTEEN_MIN, max: 30 })
// Extra limit per email so one account can't be brute-forced from many IPs
const hitLoginEmail = createRateLimiter({ windowMs: FIFTEEN_MIN, max: 10 })

export const authRoutes = new Hono<AuthEnv>()

authRoutes.post('/signup', limitByIp, jsonBody(signupSchema), async (c) => {
  const input = c.req.valid('json')
  const passwordHash = await hash(input.password, ARGON2_OPTS)

  const [user] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, displayName: input.displayName ?? null })
    .onConflictDoNothing({ target: users.email })
    .returning(userFields)

  if (!user) return c.json({ error: 'email_taken' }, 409)

  await createSession(c, user.id)
  return c.json({ user }, 201)
})

authRoutes.post('/login', limitByIp, jsonBody(loginSchema), async (c) => {
  const input = c.req.valid('json')

  const wait = hitLoginEmail(input.email)
  if (wait !== null) return tooManyRequests(c, wait)

  const [user] = await db.select().from(users).where(eq(users.email, input.email))

  let ok = false
  if (user) ok = await verify(user.passwordHash, input.password)
  else await verify(await getDummyHash(), input.password)

  if (!user || !ok) return c.json({ error: 'invalid_credentials' }, 401)

  await createSession(c, user.id)
  return c.json({ user: { id: user.id, email: user.email, displayName: user.displayName, username: user.username, showOnLeaderboard: user.showOnLeaderboard } })
})

authRoutes.post('/logout', requireAuth, async (c) => {
  await destroySession(c, c.get('sessionId'))
  return c.json({ ok: true })
})

authRoutes.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }))

// Public profile: username (for friends/leaderboards) and leaderboard visibility
const profileSchema = z.object({
  username: z.string().trim().toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, '3–20 characters: letters, numbers and _ only')
    .optional(),
  displayName: z.string().trim().min(1).max(50).nullable().optional(),
  showOnLeaderboard: z.boolean().optional(),
})

authRoutes.patch('/profile', requireAuth, jsonBody(profileSchema), async (c) => {
  const input = c.req.valid('json')
  const me = c.get('user')

  if (input.username !== undefined && input.username !== me.username) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username))
    if (taken) return c.json({ error: 'username_taken' }, 409)
  }

  try {
    const [user] = await db.update(users).set(input).where(eq(users.id, me.id)).returning(userFields)
    return c.json({ user })
  } catch (err) {
    // Two people grabbing the same name at the same moment: the unique constraint catches it
    const e = err as { code?: string, cause?: { code?: string } }
    if ((e.code ?? e.cause?.code) === '23505') return c.json({ error: 'username_taken' }, 409)
    throw err
  }
})

// Deletes the account and everything in it (decks, cards, progress, reviews,
// sessions all cascade). Asks for the password again as a safety check.
authRoutes.delete('/account', requireAuth, limitByIp, jsonBody(z.object({ password: z.string().max(256) })), async (c) => {
  const { id } = c.get('user')
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id))
  if (!user || !(await verify(user.passwordHash, c.req.valid('json').password))) {
    return c.json({ error: 'invalid_credentials' }, 401)
  }
  await db.delete(users).where(eq(users.id, id))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})
