import { z } from 'zod'
import {
  AGENT_SESSION_QUESTION_ANSWER_MAX_BYTES,
  AGENT_SESSION_RESPONSE_OPTION_ID_MAX_LENGTH
} from '../agent-session/agent-session-question-answer'
import { Identifier } from './structured-agent-session-identifiers'
import { MutationEnvelope } from './structured-agent-session-mutation-envelope'

const ApprovalNote = z
  .string()
  .max(AGENT_SESSION_QUESTION_ANSWER_MAX_BYTES)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= AGENT_SESSION_QUESTION_ANSWER_MAX_BYTES,
    'Text is too large'
  )

export const RespondParams = z
  .object({
    envelope: MutationEnvelope,
    itemId: Identifier('Invalid item id'),
    expectedRevision: z.number().int().positive(),
    optionId: Identifier('Invalid option id', AGENT_SESSION_RESPONSE_OPTION_ID_MAX_LENGTH),
    comment: ApprovalNote.optional(),
    editedSpecContent: ApprovalNote.optional()
  })
  .strict()
