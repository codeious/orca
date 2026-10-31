import type { AgentSessionContextReport } from './agent-session-context-usage'

/** What a person may type after /compress; the host refuses more than Droid is asked to weigh. */
export const DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH = 8_000

/** The commands Orca answers for a Droid chat by asking the Droid child, with no turn of their own. */
export type DroidHostCommand =
  | { name: 'context' }
  | { name: 'credits' }
  | { name: 'compress'; instructions?: string }

export type DroidHostCommandResult =
  /** Droid's breakdown, as the ring holds it; null when Droid's answer could not be read. */
  | { name: 'context'; report: AgentSessionContextReport | null }
  /** `factoryCredits` Droid last reported for the session; null when it has reported none. */
  | { name: 'credits'; factoryCredits: number | null }
  /** `newSessionId` is set only when it differs from the Droid session the chat holds. */
  | { name: 'compress'; removedCount: number | null; newSessionId: string | null }
