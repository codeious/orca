import { AgentLeaseExpiryTimers } from './agent-lease-expiry-timers'
import type { HookListenerState } from './agent-hook-listener/listener-state'
import { CLAUDE_OWED_NOTIFICATION_LEASE_PROVIDER } from './claude-owed-notification-expiry-timers'
import { DROID_BACKGROUND_CHILD_LEASE_PROVIDER } from './agent-hook-listener/providers/droid-lease-expiry'

export class HookLeaseExpiryTimers extends AgentLeaseExpiryTimers {
  constructor(state: HookListenerState) {
    super(state, [CLAUDE_OWED_NOTIFICATION_LEASE_PROVIDER, DROID_BACKGROUND_CHILD_LEASE_PROVIDER])
  }
}
