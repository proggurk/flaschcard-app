// Checks that the media bucket is reachable: `npx tsx scripts/check-bucket.ts`
import '../src/env.ts'
import { HeadBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3'
import { s3, MEDIA_BUCKET } from '../src/media/storage.ts'

try {
  await s3.send(new HeadBucketCommand({ Bucket: MEDIA_BUCKET }))
  console.log(`✔ bucket "${MEDIA_BUCKET}" is reachable`)
} catch (err) {
  console.log(`✖ bucket "${MEDIA_BUCKET}" not reachable: ${(err as Error).name}`)
  try {
    const { Buckets } = await s3.send(new ListBucketsCommand({}))
    console.log('buckets you can see:', Buckets?.map((b) => b.Name) ?? [])
  } catch (e) {
    console.log('could not list buckets either:', (e as Error).name, (e as Error).message)
  }
}
