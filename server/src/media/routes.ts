import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { and, eq } from 'drizzle-orm'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { db } from '../db/index.ts'
import { media } from '../db/schema.ts'
import { requireAuth, type AuthEnv } from '../auth/session.ts'
import { s3, MEDIA_BUCKET } from './storage.ts'

const MAX_BYTES = 25 * 1024 * 1024

// Only these types are accepted, and the content type is decided by us, not the uploader
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
  m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm',
}

// "<64 hex chars>.<ext>"
function parseName(name: string) {
  const m = /^([a-f0-9]{64})\.([a-z0-9]{1,5})$/.exec(name)
  if (!m || !CONTENT_TYPES[m[2]]) return null
  return { hash: m[1], contentType: CONTENT_TYPES[m[2]] }
}

const objectKey = (hash: string) => `media/${hash}`

export const mediaRoutes = new Hono<AuthEnv>()

mediaRoutes.put('/:name', requireAuth, bodyLimit({ maxSize: MAX_BYTES }), async (c) => {
  const name = c.req.param('name')
  const parsed = parseName(name)
  if (!parsed) return c.json({ error: 'unsupported_media' }, 415)

  const body = Buffer.from(await c.req.arrayBuffer())
  // The name *is* the hash, so a client can't overwrite someone else's file with different content
  if (createHash('sha256').update(body).digest('hex') !== parsed.hash) {
    return c.json({ error: 'hash_mismatch' }, 400)
  }

  const exists = await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: objectKey(parsed.hash) }))
    .then(() => true, () => false)
  if (!exists) {
    await s3.send(new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: objectKey(parsed.hash), Body: body }))
  }

  await db.insert(media)
    .values({ userId: c.get('user').id, name, size: body.length })
    .onConflictDoNothing()

  return c.json({ ok: true })
})

mediaRoutes.get('/:name', requireAuth, async (c) => {
  const name = c.req.param('name')
  const parsed = parseName(name)
  if (!parsed) return c.json({ error: 'not_found' }, 404)

  const [row] = await db.select({ name: media.name }).from(media)
    .where(and(eq(media.userId, c.get('user').id), eq(media.name, name)))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const obj = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: objectKey(parsed.hash) }))
  if (!obj.Body) return c.json({ error: 'not_found' }, 404)

  return new Response(Readable.toWeb(obj.Body as Readable) as ReadableStream, {
    headers: {
      'Content-Type': parsed.contentType,
      ...(obj.ContentLength !== undefined && { 'Content-Length': String(obj.ContentLength) }),
      // Content never changes for a given hash
      'Cache-Control': 'private, max-age=31536000, immutable',
      // If someone opens an uploaded SVG directly, scripts in it can't run on our domain
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
