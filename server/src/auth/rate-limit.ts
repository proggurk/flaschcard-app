import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getConnInfo } from '@hono/node-server/conninfo'

// Simple in-memory fixed-window limiter. Good enough for a single server;
// if you ever run several server instances, move this into Postgres or Redis.
export function createRateLimiter(opts: { windowMs: number, max: number }) {
  const hits = new Map<string, { count: number, resetAt: number }>()

  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  }, opts.windowMs).unref()

  // Counts one attempt for `key`. Returns seconds to wait if over the limit, else null.
  return function hit(key: string): number | null {
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs }
      hits.set(key, entry)
    }
    entry.count++
    return entry.count > opts.max ? Math.ceil((entry.resetAt - now) / 1000) : null
  }
}

export function tooManyRequests(c: Context, retryAfterSec: number) {
  c.header('Retry-After', String(retryAfterSec))
  return c.json({ error: 'too_many_requests' }, 429)
}

export function rateLimitByIp(opts: { windowMs: number, max: number }) {
  const hit = createRateLimiter(opts)
  return createMiddleware(async (c, next) => {
    const wait = hit(clientIp(c))
    if (wait !== null) return tooManyRequests(c, wait)
    await next()
  })
}

function clientIp(c: Context): string {
  // Only trust X-Forwarded-For if you deploy behind a proxy you control
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = c.req.header('x-forwarded-for')
    if (fwd) return fwd.split(',')[0].trim()
  }
  return getConnInfo(c).remote.address ?? 'unknown'
}
