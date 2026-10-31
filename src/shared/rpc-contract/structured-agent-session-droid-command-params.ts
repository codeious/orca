import { z } from 'zod'
import { DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH } from '../droid-host-command'
import { SessionId } from './structured-agent-session-params'

/** A command the host answers from the Droid child; not a journaled mutation, so no envelope. */
export const DroidCommandParams = z
  .object({
    sessionId: SessionId,
    command: z.discriminatedUnion('name', [
      z.object({ name: z.literal('context') }).strict(),
      z.object({ name: z.literal('credits') }).strict(),
      z
        .object({
          name: z.literal('compress'),
          instructions: z.string().max(DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH).optional()
        })
        .strict()
    ])
  })
  .strict()
