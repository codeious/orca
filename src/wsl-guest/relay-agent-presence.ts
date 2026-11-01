import { watchDroidExit } from '../shared/agent-hook-listener/providers/droid-sessions'
import type { AgentHookEventPayload } from '../shared/agent-hook-listener/listener-event'
import type { HookListenerState } from '../shared/agent-hook-listener/listener-state'
import { AgentProcessExitWatch } from '../shared/agent-process-exit-watch'
import type { AgentProcessVerdict } from '../shared/agent-process-presence'
import { probeAgentProcessPresence } from '../shared/agent-process-presence-probe'
import type { AgentHookSource } from '../shared/agent-hook-relay'
import type { CachedPaneEnvelopeMeta } from './agent-hook-cached-pane-status'

type RelayPresenceHost = {
  state: HookListenerState
  metadata: ReadonlyMap<string, CachedPaneEnvelopeMeta>
  apply: (
    event: AgentHookEventPayload,
    source: AgentHookSource,
    env?: string,
    version?: string
  ) => void
}

export class RelayAgentPresence {
  private readonly pending = new WeakMap<
    AgentHookEventPayload,
    Promise<AgentProcessVerdict | null>
  >()
  private readonly exitWatch = new AgentProcessExitWatch()
  private readonly host: RelayPresenceHost

  constructor(host: RelayPresenceHost) {
    this.host = host
  }

  /** Asks the pane's process once; `null` when there is nothing to ask. */
  probe(paneKey: string): Promise<AgentProcessVerdict | null> {
    const { state, metadata, apply } = this.host
    const row = state.lastStatusByPaneKey.get(paneKey)
    const meta = metadata.get(paneKey)
    if (!row?.agentPresence?.process || row.agentPresence.ended) {
      return Promise.resolve(null)
    }
    const existing = this.pending.get(row)
    if (existing) {
      return existing
    }
    const presence = row.agentPresence
    const check = probeAgentProcessPresence(presence.process)
      .then((verdict) => {
        if (verdict === 'exited' && meta && state.lastStatusByPaneKey.get(paneKey) === row) {
          apply(
            {
              ...row,
              hookEventName: 'AgentProcessExit',
              agentPresence: { ...presence, ended: true }
            },
            meta.source,
            meta.env,
            meta.version
          )
        }
        return verdict
      })
      .finally(() => this.pending.delete(row))
    this.pending.set(row, check)
    return check
  }

  check(paneKey: string): Promise<void> {
    return this.probe(paneKey).then(() => undefined)
  }

  watchDroidExit(paneKey: string): void {
    watchDroidExit(this.host.state, this.exitWatch, paneKey, () => this.probe(paneKey))
  }

  stop(): void {
    this.exitWatch.stopAll()
  }
}
