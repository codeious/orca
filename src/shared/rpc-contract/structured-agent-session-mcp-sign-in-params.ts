import { z } from 'zod'
import { SessionId } from './structured-agent-session-params'

export const McpSignInOpenedParams = z
  .object({
    sessionId: SessionId,
    requestId: z.string().min(1).max(200),
    opened: z.boolean()
  })
  .strict()
