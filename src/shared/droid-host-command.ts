import type { AgentSessionContextReport } from './agent-session-context-usage'

/** What a person may type after /compress; the host refuses more than Droid is asked to weigh. */
export const DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH = 8_000

/** What the wire accepts as a typed folder and as a skill name. */
export const DROID_WORKING_FOLDER_MAX_LENGTH = 4_096
export const DROID_SKILL_NAME_MAX_LENGTH = 200

/** The commands Orca answers for a Droid chat by asking the Droid child, with no turn of their own.
 *  `rewind` names the message Droid itself echoed, never an Orca row id. `cwd` serves /cwd and /cd. */
export type DroidHostCommand =
  | { name: 'context' }
  | { name: 'credits' }
  | { name: 'compress'; instructions?: string }
  | { name: 'fork' }
  | { name: 'rename'; title: string }
  | { name: 'cwd'; path: string }
  | { name: 'skills'; toggle?: { skillName: string; disabled: boolean } }
  | { name: 'rewind'; messageId: string }

/** What a client asks. A rewind names a row of the chat; the host turns it into the message Droid
 *  knows it by, because only the host holds the journal that says which one that is. */
export type DroidHostCommandRequest =
  | Exclude<DroidHostCommand, { name: 'rewind' }>
  | { name: 'rewind'; itemId: string }

export type DroidHostCommandResult =
  /** Droid's breakdown, as the ring holds it; null when Droid's answer could not be read. */
  | { name: 'context'; report: AgentSessionContextReport | null }
  /** `factoryCredits` Droid last reported for the session; null when it has reported none. */
  | { name: 'credits'; factoryCredits: number | null }
  /** `newSessionId` is set only when it differs from the Droid session the chat holds. */
  | { name: 'compress'; removedCount: number | null; newSessionId: string | null }
  /** The fork Droid made; always a different session from the one the chat holds. */
  | { name: 'fork'; newSessionId: string }
  /** The title Droid was given, flattened to the one line a chat name can be. */
  | { name: 'rename'; title: string }
  /** The folder Droid now works in, as it reported it. */
  | { name: 'cwd'; resolvedPath: string }
  /** The skills Droid lists once any change is made; `changed` is the toggle that was just made. */
  | {
      name: 'skills'
      skills: { name: string; enabled: boolean }[]
      changed: { skillName: string; disabled: boolean } | null
    }
  /** `notRestoredCount` is every file Droid could not put back: evicted from its store, or failed. */
  | {
      name: 'rewind'
      newSessionId: string
      restoredCount: number
      deletedCount: number
      notRestoredCount: number
    }
