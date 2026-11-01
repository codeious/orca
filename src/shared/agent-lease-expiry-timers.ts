import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import type { HookListenerState } from './agent-hook-listener/listener-state'
import { mainAgentIdleSince } from './agent-hook-listener/main-agent-turn-state'
import { settleDroidLeaseExpiry } from './agent-hook-listener/providers/droid-events'
import {
  DROID_BACKGROUND_CHILD_LEASE_MS,
  droidBackgroundChildLeaseDeadline
} from './agent-hook-listener/providers/droid-session-status'
import { claudeRowHasUnlistedLiveWork } from './agent-hook-listener/providers/claude-pane-hold-evidence'
import { buildClaudeCachedLeadStatusPayload } from './agent-hook-listener/providers/claude-lifecycle-events'
import {
  CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS,
  claudeOwedTaskNotificationDeadline
} from './claude-owed-task-notifications'
import { CodexSubagentPollScheduler } from './codex-subagent-poll-scheduler'

type PublishRow = (row: AgentHookEventPayload) => void
type Lease = { provider: 'claude' | 'droid'; deadline: number; maxDelayMs: number }

/** Wakes the execution host (main for local panes, the relay for remote ones) when a pane is held
 *  `working` only by a lease: Claude task notifications still owed, or a stopped Droid lead's
 *  finished background child. Nothing arrives when the notification is never sent or the lead never
 *  wakes, so the row must be restated. A firing re-reads the pane, so a wakeup left behind by a
 *  closed or moved pane is a no-op and needs no teardown of its own. */
export class AgentLeaseExpiryTimers {
  private readonly wakeups = new CodexSubagentPollScheduler<PublishRow>(0, (paneKey, publish) =>
    this.restate(paneKey, publish)
  )

  constructor(private readonly state: HookListenerState) {}

  /** Call whenever a pane's row is stored; `publish` applies the restated row as the host would. */
  arm(paneKey: string, publish: PublishRow): void {
    const lease = this.lease(paneKey)
    if (lease === undefined) {
      this.wakeups.clear(paneKey)
      return
    }
    // Why capped: a wall clock stepped far back would otherwise ask for a delay setTimeout cannot
    // hold; restate() re-checks the deadline, so waking early only re-arms.
    const delay = Math.min(lease.maxDelayMs, Math.max(0, lease.deadline - Date.now()))
    this.wakeups.schedule(paneKey, publish, delay)
  }

  clearAll(): void {
    this.wakeups.clearAll()
  }

  private lease(paneKey: string): Lease | undefined {
    const droid = this.state.droidSessionsByPaneKey.get(paneKey)
    const droidDeadline = droid && droidBackgroundChildLeaseDeadline(droid)
    if (droidDeadline !== undefined) {
      return {
        provider: 'droid',
        deadline: droidDeadline,
        maxDelayMs: DROID_BACKGROUND_CHILD_LEASE_MS
      }
    }
    // Only an idle main agent has a Claude lease: it does not run while the agent is in a turn.
    const idleSince = mainAgentIdleSince(this.state.claudeLeadStateByPaneKey.get(paneKey))
    const claudeDeadline =
      idleSince === undefined
        ? undefined
        : claudeOwedTaskNotificationDeadline(
            this.state.claudeLaunchedBackgroundTasksByPaneKey.get(paneKey),
            idleSince
          )
    return claudeDeadline === undefined
      ? undefined
      : {
          provider: 'claude',
          deadline: claudeDeadline,
          maxDelayMs: CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS
        }
  }

  private restate(paneKey: string, publish: PublishRow): void {
    const lease = this.lease(paneKey)
    if (lease === undefined) {
      return
    }
    // Why: a timer can fire before the wall clock reaches the deadline the lease is judged by.
    if (lease.deadline > Date.now()) {
      this.arm(paneKey, publish)
      return
    }
    const row = this.state.lastStatusByPaneKey.get(paneKey)
    const settled = row && this.settle(lease.provider, paneKey, row)
    if (settled) {
      publish(settled)
    }
  }

  private settle(
    provider: Lease['provider'],
    paneKey: string,
    row: AgentHookEventPayload
  ): AgentHookEventPayload | null {
    if (provider === 'droid') {
      const payload =
        row.payload.agentType === 'droid' ? settleDroidLeaseExpiry(this.state, paneKey) : null
      // Why the stored row's envelope: its launch token and owner must reach the same fences a
      // hook's row does; like a transcript-poll restatement, it is no hook event and no new prompt.
      return payload && { ...row, hasExplicitPrompt: undefined, hookEventName: undefined, payload }
    }
    // Why the builder a child's end re-emits through: the fold it runs is what gives up on the
    // expired notifications, and the row must read exactly like every other Claude row.
    const payload = buildClaudeCachedLeadStatusPayload(this.state, undefined, paneKey, {})
    return (
      payload && {
        ...row,
        hasExplicitPrompt: undefined,
        hookEventName: undefined,
        claudeRunningNonAgentTask: claudeRowHasUnlistedLiveWork(this.state, paneKey),
        payload
      }
    )
  }
}
