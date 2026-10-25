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

export type AiVaultDroidSessionHolderResult = { holder: AiVaultDroidSessionHolder }

/** Every path that could not ask the owning host answers this, never `null`: a host that was not
 *  asked, an older host without the method, and a lost connection are all "cannot tell". */
export const AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL: AiVaultDroidSessionHolder = 'unverifiable'

export const aiVaultDroidSessionHolderResultSchema = z.object({
  holder: z.enum(['live', 'unverifiable']).nullable()
})

/** A malformed or missing reply is "cannot tell", not a free session. */
export function parseAiVaultDroidSessionHolder(value: unknown): AiVaultDroidSessionHolder {
  const parsed = aiVaultDroidSessionHolderResultSchema.safeParse(value)
  return parsed.success ? parsed.data.holder : AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
}
