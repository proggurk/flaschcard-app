import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.ts'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = drizzle(pool, { schema })
