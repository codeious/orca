import * as z from 'zod'
import type { AgentProcessVerdict } from '../../agent-status/process/agent-process-presence'

/** A process proven exited holds nothing. */
export type AiVaultSessionHolderVerdict = Exclude<AgentProcessVerdict, 'exited'>

/** One terminal pane that still claims the conversation, with what its own process says. */
export type AiVaultHoldingPane = {
  paneKey: string
  verdict: AiVaultSessionHolderVerdict
}

export type AiVaultSessionHolderResult = {
  /** `null` is the one answer that frees the conversation: the host knows of no pane holding it. */
  holder: AiVaultSessionHolderVerdict | null
  /** Missing panes mean "cannot tell which pane", never "no pane". A free answer carries none. */
  panes?: AiVaultHoldingPane[]
}

/** A host that was not asked, lacks the method or lost its connection cannot free the conversation. */
export const AI_VAULT_SESSION_HOLDER_CANNOT_TELL_RESULT: AiVaultSessionHolderResult = Object.freeze(
  { holder: 'unverifiable' }
)

const holderVerdictSchema: z.ZodType<AiVaultSessionHolderVerdict> = z.enum(['live', 'unverifiable'])

// An unreadable pane list must not cost the holder; zod 4 makes a bare unknown key required.
const holderReplySchema = z.object({
  holder: holderVerdictSchema.nullable(),
  panes: z.unknown().optional()
})

const holdingPanesSchema = z.array(
  z.object({ paneKey: z.string().min(1), verdict: holderVerdictSchema })
)

/** A malformed or missing reply is "cannot tell", not a free conversation. */
export function parseAiVaultSessionHolderResult(value: unknown): AiVaultSessionHolderResult {
  const reply = holderReplySchema.safeParse(value)
  if (!reply.success) {
    return AI_VAULT_SESSION_HOLDER_CANNOT_TELL_RESULT
  }
  const { holder, panes } = reply.data
  if (holder === null) {
    return { holder }
  }
  const holding = holdingPanesSchema.safeParse(panes)
  return holding.success ? { holder, panes: holding.data } : { holder }
}
