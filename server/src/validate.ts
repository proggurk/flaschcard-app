import { zValidator } from '@hono/zod-validator'
import type { ZodType } from 'zod'

// Validates the JSON body against a zod schema; bad input => 400 with readable messages.
export const jsonBody = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({
        error: 'invalid_input',
        issues: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      }, 400)
    }
  })
