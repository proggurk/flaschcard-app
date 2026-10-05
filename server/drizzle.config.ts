import './src/env.ts'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle', // generated .sql migration files end up here
  dialect: 'postgresql',
  dbCredentials: {
    // Direct (non-pooled) connection is safer for migrations
    url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)!,
  },
})
