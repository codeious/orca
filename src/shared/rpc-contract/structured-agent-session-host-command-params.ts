import { z } from 'zod'
import { MutationEnvelope } from './structured-agent-session-mutation-envelope'

export const HostCommandParams = z.strictObject({
  envelope: MutationEnvelope,
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9-]*$/),
  argument: z.string().max(8_000)
})
export const CopyConversationParams = z.strictObject({ envelope: MutationEnvelope })
