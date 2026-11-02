import { z } from 'zod'
import type { AgentProcessVerdict } from './agent-process-presence'

export const AI_VAULT_SESSION_HOLDER_CAPABILITY = 'ai-vault.session-holder.v1' as const

/** A process proven exited holds nothing. */
export type AiVaultSessionHolderVerdict = Exclude<AgentProcessVerdict, 'exited'>

/** `null` is the one answer that frees the session: the host knows of no pane holding it. */
export type AiVaultSessionHolder = AiVaultSessionHolderVerdict | null

/** One terminal pane that still has a claim on the session, with what its own process says. */
export type AiVaultHoldingPane = {
  paneKey: string
  verdict: AiVaultSessionHolderVerdict
}

export type AiVaultSessionHolderResult = {
  holder: AiVaultSessionHolder
  /** Absent from a host that predates it: that is "cannot tell which pane", not "no pane", and
   *  never frees the session. A free (`null`) answer carries none. */
  panes?: AiVaultHoldingPane[]
}

/** Every path that could not ask the owning host answers this, never `null`: a host that was not
 *  asked, an older host without the method, and a lost connection are all "cannot tell". */
export const AI_VAULT_SESSION_HOLDER_CANNOT_TELL_RESULT: AiVaultSessionHolderResult = Object.freeze(
  { holder: 'unverifiable' }
)

// Typed against the union so the schema cannot admit a verdict the type excludes.
const holderVerdictSchema: z.ZodType<AiVaultSessionHolderVerdict> = z.enum(['live', 'unverifiable'])

// `panes` stays unknown here so a pane list this client cannot read never costs the holder.
// zod 4 treats a bare `z.unknown()` key as required, which would make a host that omits it unreadable.
const holderReplySchema = z.object({
  holder: holderVerdictSchema.nullable(),
  panes: z.unknown().optional()
})

const holdingPanesSchema = z.array(
  z.object({ paneKey: z.string().min(1), verdict: holderVerdictSchema })
)

/** A malformed or missing reply is "cannot tell", not a free session. */
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
