import { S3Client } from '@aws-sdk/client-s3'

// Neon object storage speaks the S3 protocol. Credentials and endpoint come from
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3 / AWS_REGION,
// which `neon link` wrote to .env.local.
export const s3 = new S3Client({ forcePathStyle: true })

// Declared in neon.ts (`buckets: { bucket: ... }`)
export const MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? 'bucket'
