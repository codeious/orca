import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import type { HookListenerState } from './agent-hook-listener/listener-state'
import { CodexSubagentPollScheduler } from './codex-subagent-poll-scheduler'

type PublishRow = (row: AgentHookEventPayload) => void
export type AgentLease = { deadline: number; maxDelayMs: number }
export type AgentLeaseExpiryProvider = {
  lease(state: HookListenerState, paneKey: string): AgentLease | undefined
  settle(
    state: HookListenerState,
    paneKey: string,
    row: AgentHookEventPayload
  ): AgentHookEventPayload | null
}

/** Re-read host-owned leases when no further hook arrives; moved or closed panes are no-ops. */
export class AgentLeaseExpiryTimers {
  private readonly wakeups = new CodexSubagentPollScheduler<PublishRow>(0, (paneKey, publish) =>
    this.restate(paneKey, publish)
  )

  constructor(
    private readonly state: HookListenerState,
    private readonly providers: readonly AgentLeaseExpiryProvider[]
  ) {}

  arm(paneKey: string, publish: PublishRow): void {
    const entry = this.lease(paneKey)
    if (!entry) {
      this.wakeups.clear(paneKey)
      return
    }
    // Recheck after backward clock steps instead of scheduling an unbounded delay.
    const delay = Math.min(entry.lease.maxDelayMs, Math.max(0, entry.lease.deadline - Date.now()))
    this.wakeups.schedule(paneKey, publish, delay)
  }

  clearAll(): void {
    this.wakeups.clearAll()
  }

  private lease(paneKey: string) {
    for (const provider of this.providers) {
      const lease = provider.lease(this.state, paneKey)
      if (lease) {
        return { provider, lease }
      }
    }
    return undefined
  }

  private restate(paneKey: string, publish: PublishRow): void {
    const entry = this.lease(paneKey)
    if (!entry) {
      return
    }
    if (entry.lease.deadline > Date.now()) {
      this.arm(paneKey, publish)
      return
    }
    const row = this.state.lastStatusByPaneKey.get(paneKey)
    const settled = row && entry.provider.settle(this.state, paneKey, row)
    if (settled) {
      publish(settled)
    }
  }
}
