import { RelaySessionGenerations } from './server-relay-sessions'

import type { EnrichedAgentHookEventPayload } from './server-types'

import { HookLeaseExpiryTimers } from '../../../shared/agent-hook-listener/leases/hook-lease-expiry-timers'

import { AgentHookServerStatusApplication } from './server-status-application'

export abstract class AgentHookServerStatusRowMutation extends AgentHookServerStatusApplication {
  protected readonly leaseExpiry = new HookLeaseExpiryTimers(this.state)

  protected readonly relaySessions = new RelaySessionGenerations()

  // Every row mutation passes here, including cancellation and pane moves.
  protected override commitStatusRowMutation(
    before: EnrichedAgentHookEventPayload | null | undefined,
    after: EnrichedAgentHookEventPayload | null | undefined,
    emit = true
  ): boolean {
    if (after) {
      this.leaseExpiry.arm(after.paneKey, (row) => {
        if (this.server) {
          this.applyRestatedStatus(row)
        }
      })
    }
    return super.commitStatusRowMutation(before, after, emit)
  }
}
