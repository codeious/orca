import { randomUUID } from 'node:crypto'
import type { AgentSessionJournalIdentity } from '../../../../shared/agent-session/journal/agent-session-journal-identity'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { AgentChatPermissionChoice } from '../../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import type { StructuredAgentSessionEventSink } from '../journal-ingress/structured-agent-session-event-sink'
import type { StructuredAgentSessionStartupAttempt } from './structured-agent-session-startup-attempt-contract'
import { AgentSessionExecutionOptionsSchema } from '../../../../shared/agent-session/options/agent-session-execution-options'
import type { StructuredAgentDefinition } from '../providers/structured-agent-definition'

const executionOptionKeys = new Set(Object.keys(AgentSessionExecutionOptionsSchema.shape))

export function mintStructuredAgentSessionStartupAttempt(input: {
  record: AgentSessionRecord
  identity: AgentSessionJournalIdentity
  spawnToken: string
  permissionMode?: AgentChatPermissionChoice
  events?: StructuredAgentSessionEventSink
  signal?: AbortSignal
  startupOptions?: Readonly<Record<string, string>>
  restingOptions: StructuredAgentDefinition['restingOptions'] | undefined
  attemptId?: string
}): StructuredAgentSessionStartupAttempt {
  const { record, restingOptions } = input
  const selected = input.startupOptions
    ? {
        ...Object.fromEntries(
          Object.entries(record.options ?? {}).filter(
            ([key]) => restingOptions?.acceptsKey(key) && !executionOptionKeys.has(key)
          )
        ),
        ...input.startupOptions
      }
    : record.options
  const options = record.provider === 'claude' ? { fastMode: 'false', ...selected } : selected
  return {
    attemptId: input.attemptId ?? randomUUID(),
    identity: input.identity,
    fence: record.lease.runtimeFence,
    spawnToken: input.spawnToken,
    launch: {
      location: record.location,
      accountHome: record.accountHome,
      ...(record.launchDirectory === undefined ? {} : { launchDirectory: record.launchDirectory })
    },
    ...(options ? { options } : {}),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    ...(input.events ? { events: input.events } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  }
}
