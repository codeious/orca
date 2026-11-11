import type { AgentType } from '../../agent-status/contracts/agent-status-types'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../native-chat/input/native-chat-session-options'
import type { AgentSessionConversationCommand } from '../agent-session-conversation-command'
import type { AgentSessionThreadGoalChange } from '../agent-session-thread-goal-wire'
import type { AgentSessionSlashCommand } from '../agent-session-wire'
import type {
  StructuredComposerFailureCode,
  StructuredComposerFailureParams
} from '../failures/structured-agent-session-composer-failure'

export type StructuredAgentSessionComposerOptions = {
  agent?: AgentType
  snapshot: readonly SessionOptionDescriptor[]
  invokeAction: (id: string) => Promise<boolean>
  setOption: (id: string, value: SessionOptionValue) => Promise<boolean>
  /** What the running session reported for its `/` menu; undefined until read or on an older host. */
  sessionCommands?: readonly AgentSessionSlashCommand[]
  conversationCommands?: readonly AgentSessionConversationCommand[]
  /** Text after `/compact` reaches the agent; without this it is refused, never dropped. */
  compactInstructions?: boolean
  runConversationCommand?: (
    command: AgentSessionConversationCommand,
    instructions?: string,
    onSent?: () => void
  ) => Promise<Omit<StructuredAgentSessionCommandOutcome, 'handled'>>
  runHostCommand?: (
    name: string,
    argument: string
  ) => Promise<Omit<StructuredAgentSessionCommandOutcome, 'handled'>>
  runSessionAction?: (
    name: 'rename' | 'fork',
    argument: string
  ) => Promise<Omit<StructuredAgentSessionCommandOutcome, 'handled'>>
  /** Without host goal support, /goal remains agent-handled text. */
  changeThreadGoal?: (change: AgentSessionThreadGoalChange) => Promise<boolean>
}

/** Visible condition holding a refusal: agent/prompt/background work, an in-flight send or a Retry card. */
export type StructuredAgentSessionCommandRefusalCause =
  | 'working'
  | 'prompt'
  | 'background'
  | 'sending'
  | 'retry'

export type StructuredAgentSessionCommandOutcome = {
  handled: boolean
  accepted: boolean
  error: string | null
  /** Set on refusals this module words, so a client can translate `error`. */
  errorCode?: StructuredComposerFailureCode
  errorParams?: StructuredComposerFailureParams
  /** Show refusal only while this condition holds. */
  refusedWhile?: StructuredAgentSessionCommandRefusalCause
}
