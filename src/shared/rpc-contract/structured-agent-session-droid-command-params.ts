import { z } from 'zod'
import { AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH } from '../agent-session-conversation-name'
import {
  DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH,
  DROID_SKILL_NAME_MAX_LENGTH,
  DROID_WORKING_FOLDER_MAX_LENGTH
} from '../droid-host-command'
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
        .strict(),
      z.object({ name: z.literal('fork') }).strict(),
      z
        .object({
          name: z.literal('rename'),
          title: z.string().min(1).max(AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH)
        })
        .strict(),
      z
        .object({
          name: z.literal('cwd'),
          path: z.string().min(1).max(DROID_WORKING_FOLDER_MAX_LENGTH)
        })
        .strict(),
      z
        .object({
          name: z.literal('skills'),
          toggle: z
            .object({
              skillName: z.string().min(1).max(DROID_SKILL_NAME_MAX_LENGTH),
              disabled: z.boolean()
            })
            .strict()
            .optional()
        })
        .strict(),
      z.object({ name: z.literal('rewind'), itemId: z.string().min(1) }).strict()
    ])
  })
  .strict()
