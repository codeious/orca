import { z } from 'zod'
import type { AgentProcessVerdict } from './agent-process-presence'

export const AI_VAULT_DROID_SESSION_HOLDER_CHANNEL = 'aiVault:droidSessionHolder'

/** What a terminal pane's process says about a Droid session. A process proven exited holds
 *  nothing, so `exited` is not an answer here. */
export type AiVaultDroidSessionHolderVerdict = Exclude<AgentProcessVerdict, 'exited'>

/** `null` is the one answer that frees the session: the host knows of no pane holding it. */
export type AiVaultDroidSessionHolder = AiVaultDroidSessionHolderVerdict | null

// The host id is a plain string: it arrives unvalidated and is parsed where it routes.
export type AiVaultDroidSessionHolderArgs = {
  executionHostId: string
  sessionId: string
}

/** One terminal pane that still has a claim on the session, with what its own process says. */
export type AiVaultDroidHoldingPane = {
  paneKey: string
  verdict: AiVaultDroidSessionHolderVerdict
}

export type AiVaultDroidSessionHolderResult = {
  holder: AiVaultDroidSessionHolder
  /** Absent from a host that predates it: that is "cannot tell which pane", not "no pane", and
   *  never frees the session. A free (`null`) answer carries none. */
  panes?: AiVaultDroidHoldingPane[]
}

/** Every path that could not ask the owning host answers this, never `null`: a host that was not
 *  asked, an older host without the method, and a lost connection are all "cannot tell". */
export const AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL: AiVaultDroidSessionHolder = 'unverifiable'

export const AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT: AiVaultDroidSessionHolderResult =
  Object.freeze({ holder: AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL })

// `panes` stays unknown here so a pane list this client cannot read never costs the holder.
// zod 4 treats a bare `z.unknown()` key as required, which would make a host that omits it unreadable.
const holderReplySchema = z.object({
  holder: z.enum(['live', 'unverifiable']).nullable(),
  panes: z.unknown().optional()
})

const holdingPanesSchema = z.array(
  z.object({ paneKey: z.string().min(1), verdict: z.enum(['live', 'unverifiable']) })
)

/** A malformed or missing reply is "cannot tell", not a free session. */
export function parseAiVaultDroidSessionHolderResult(
  value: unknown
): AiVaultDroidSessionHolderResult {
  const reply = holderReplySchema.safeParse(value)
  if (!reply.success) {
    return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT
  }
  const { holder, panes } = reply.data
  if (holder === null) {
    return { holder }
  }
  const holding = holdingPanesSchema.safeParse(panes)
  return holding.success ? { holder, panes: holding.data } : { holder }
}

export function parseAiVaultDroidSessionHolder(value: unknown): AiVaultDroidSessionHolder {
  return parseAiVaultDroidSessionHolderResult(value).holder
}
