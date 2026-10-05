import { config } from 'dotenv'

// server/.env for server-only settings (PORT, CLIENT_ORIGIN...), then the
// project-root .env.local that `neon link` writes (DATABASE_URL, bucket keys).
// The first file that sets a variable wins.
config({ path: ['.env', '../.env.local'], quiet: true })
