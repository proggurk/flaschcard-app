import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { db } from '../db/index.ts'
import { sessions, users } from '../db/schema.ts'

export const SESSION_COOKIE = 'session'
const SESSION_DAYS = 60       // long-lived: the app should keep working offline for weeks
const RENEW_WITHIN_DAYS = 30  // extend the session when it's used and has less than this left
const DAY_MS = 24 * 60 * 60 * 1000

export interface SessionUser {
  id: string
  email: string
  displayName: string | null
  username: string | null
  showOnLeaderboard: boolean
}

// The user fields sent to the app (never the password hash)
export const userFields = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  username: users.username,
  showOnLeaderboard: users.showOnLeaderboard,
}

export type AuthEnv = {
  Variables: {
    user: SessionUser
    sessionId: string
  }
}

// The cookie holds a random token; the database only stores its hash.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS)
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt })
  setSessionCookie(c, token, expiresAt)
}

export async function destroySession(c: Context, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,                                  // JavaScript can't read it (protects against XSS)
    secure: process.env.NODE_ENV === 'production',   // HTTPS-only in production
    sameSite: 'Lax',                                 // not sent on cross-site requests (CSRF protection)
    path: '/',
    expires: expiresAt,
  })
}

async function validateSession(c: Context): Promise<{ user: SessionUser, sessionId: string } | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null

  const sessionId = hashToken(token)
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: userFields,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))

  if (!row) return null

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
    return null
  }

  // Sliding expiry: active users stay logged in
  if (row.expiresAt.getTime() - Date.now() < RENEW_WITHIN_DAYS * DAY_MS) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS)
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId))
    setSessionCookie(c, token, expiresAt)
  }

  return { user: row.user, sessionId }
}

// Put this in front of any route that needs a logged-in user.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await validateSession(c)
  if (!session) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ error: 'not_authenticated' }, 401)
  }
  c.set('user', session.user)
  c.set('sessionId', session.sessionId)
  await next()
})
