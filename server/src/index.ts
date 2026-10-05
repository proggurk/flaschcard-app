import './env.ts'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'
import { HTTPException } from 'hono/http-exception'
import { sql } from 'drizzle-orm'
import { db } from './db/index.ts'
import { authRoutes } from './auth/routes.ts'
import { syncRoutes } from './sync.ts'
import { mediaRoutes } from './media/routes.ts'
import { socialRoutes } from './social.ts'

const isProduction = process.env.NODE_ENV === 'production'

// Without the right origin the CSRF check rejects every request, so fail loudly instead
if (isProduction && !process.env.CLIENT_ORIGIN) throw new Error('CLIENT_ORIGIN must be set in production (e.g. https://flashcards.example.com)')
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

const app = new Hono()

app.use('*', secureHeaders())
app.use('/api/*', cors({ origin: clientOrigin, credentials: true }))
app.use('/api/*', csrf({ origin: clientOrigin }))

app.get('/api/health', async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ ok: true, db: 'connected' })
  } catch (err) {
    console.error(err)
    return c.json({ ok: false, db: 'unreachable' }, 500)
  }
})

app.route('/api/auth', authRoutes)
app.route('/api/sync', syncRoutes)
app.route('/api/media', mediaRoutes)
app.route('/api/social', socialRoutes)

// In production this server also serves the built app (`npm run build` -> dist/),
// so the app and API share one address. In development Vite does that instead.
if (isProduction) {
  app.use('*', serveStatic({
    root: fileURLToPath(new URL('../../dist', import.meta.url)),
    onFound: (_path, c) => {
      // Files in /assets/ have a hash in their name, so a new version gets a new
      // URL: cache them forever. Everything else (index.html, sw.js) must be
      // re-checked, or phones would keep running an old version.
      c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  }))
}

app.onError((err, c) => {
  // Deliberate errors (403 from CSRF check, 400 for malformed JSON...) keep their status
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.json({ error: 'internal_error' }, 500)
})

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`API running on http://localhost:${port}`)
})
