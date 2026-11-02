import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import type {
  AgentSessionDispatchOutcome,
  StructuredAgentSessionLifecycleEvent
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'
import type { DroidAgentConnection, DroidAgentConnectionOptions } from './droid-agent-connection'
import type { DroidCompactionSummaryReader } from './droid-compaction-summary'
import type { DroidSpecHandoff } from './droid-spec-handoff'

export type DroidConnection = Pick<
  DroidAgentConnection,
  | 'request'
  | 'close'
  | 'pauseReading'
  | 'resumeReading'
  | 'pid'
  | 'closed'
  | 'rootVerdict'
  | 'processless'
  | 'lastCloseResult'
  | 'onExit'
  | 'protocolVersion'
>

export type DroidSessionDeps = {
  readCompactionSummary?: DroidCompactionSummaryReader
  onSpecHandoff?: (sourceSessionId: string, handoff: DroidSpecHandoff) => Promise<void>
  openConnection?: (
    launch: ProviderProcessLaunch,
    handlers: DroidAgentConnectionOptions
  ) => DroidConnection
  onLifecycle: (event: StructuredAgentSessionLifecycleEvent) => void
  onSettled: (input: {
    sessionId: string
    clientMessageId: string
    fence: number
    outcome: AgentSessionDispatchOutcome
  }) => void
  onIdle: (input: { sessionId: string }) => void
  logger: StructuredAgentSessionLogger
  /** Resolves a folder to its real path; replaced in tests. */
  realpath?: (path: string) => Promise<string>
}
