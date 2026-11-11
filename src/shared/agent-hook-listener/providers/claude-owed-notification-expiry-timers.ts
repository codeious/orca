import { mainAgentIdleSince } from '../main-agent-turn-state'
import { claudeRowHasUnlistedLiveWork } from './claude-pane-hold-evidence'
import { buildClaudeCachedLeadStatusPayload } from './claude-lifecycle-events'
import {
  CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS,
  claudeOwedTaskNotificationDeadline
} from './claude-owed-task-notifications'
import type { AgentLeaseExpiryProvider } from '../agent-lease-expiry-timers'

export const CLAUDE_OWED_NOTIFICATION_LEASE_PROVIDER: AgentLeaseExpiryProvider = {
  lease(state, paneKey) {
    const idleSince = mainAgentIdleSince(state.claudeLeadStateByPaneKey.get(paneKey))
    const deadline =
      idleSince === undefined
        ? undefined
        : claudeOwedTaskNotificationDeadline(
            state.claudeLaunchedBackgroundTasksByPaneKey.get(paneKey),
            idleSince
          )
    return deadline === undefined
      ? undefined
      : { deadline, maxDelayMs: CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS }
  },
  settle(state, paneKey, row) {
    const payload = buildClaudeCachedLeadStatusPayload(state, undefined, paneKey, {})
    return payload
      ? {
          ...row,
          hasExplicitPrompt: undefined,
          hookEventName: undefined,
          claudeRunningNonAgentTask: claudeRowHasUnlistedLiveWork(state, paneKey),
          payload
        }
      : null
  }
}
