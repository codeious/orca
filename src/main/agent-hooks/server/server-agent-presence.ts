import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import {
  isSameAgentProcess,
  type AgentProcessVerdict
} from '../../../shared/agent-process-presence'
import { probeAgentProcessPresence } from '../../../shared/agent-process-presence-probe'
import { AgentProcessExitWatch } from '../../../shared/agent-process-exit-watch'
import { droidExitMarker } from '../../../shared/agent-hook-listener/providers/droid-sessions'
import { AgentHookServerLifecycle } from './server-lifecycle'

export type DroidSessionHolder = Exclude<AgentProcessVerdict, 'exited'>

export abstract class AgentHookServerAgentPresence extends AgentHookServerLifecycle {
  private readonly presenceChecks = new WeakMap<
    AgentHookEventPayload,
    Promise<AgentProcessVerdict | null>
  >()
  private readonly exitWatch = new AgentProcessExitWatch()

  /** A live hook proves its own process alive; only another process's hook casts doubt on the owner. */
  checkAgentPresenceAfterHook(event: AgentHookEventPayload, row: AgentHookEventPayload): void {
    const sender = event.agentPresence?.process
    const owner = row.agentPresence
    if (sender && owner?.process && !owner.ended && !isSameAgentProcess(sender, owner.process)) {
      void this.checkAgentPresence(row.paneKey)
    }
    if (event.source === 'droid' && event.hookEventName === 'SessionEnd') {
      this.watchDroidExit(row.paneKey)
    }
  }

  stop(): void {
    this.exitWatch.stopAll()
    super.stop()
  }

  /** A Droid SessionEnd is no proof of exit, so ask the process until it answers or the window closes. */
  private watchDroidExit(paneKey: string): void {
    const marker = droidExitMarker(this.state, paneKey)
    if (marker) {
      this.exitWatch.start(paneKey, {
        isCurrent: () => droidExitMarker(this.state, paneKey) === marker,
        probe: () => this.checkAgentPresence(paneKey)
      })
    }
  }

  /** Whether this pane's owner carries a process identity that its execution host can check. */
  hasVerifiableAgentProcess(paneKey: string): boolean {
    const presence = this.state.lastStatusByPaneKey.get(
      this.resolvePaneKeyAlias(paneKey)
    )?.agentPresence
    return presence?.process !== undefined && !presence.ended
  }

  /** The firmest hold a terminal pane has on a Droid session, or null when none does. */
  async droidSessionHolder(sessionId: string): Promise<DroidSessionHolder | null> {
    // Why: a pane has no row until its first prompt, so a resumed session idling at its prompt is
    // only in the pane's session record.
    const panes = new Set<string>()
    for (const [paneKey, row] of this.state.lastStatusByPaneKey) {
      if (row.providerSession?.id === sessionId) {
        panes.add(paneKey)
      }
    }
    for (const [paneKey, sessions] of this.state.droidSessionsByPaneKey) {
      if (sessions.leadId === sessionId) {
        panes.add(paneKey)
      }
    }
    const checks: Promise<AgentProcessVerdict | null>[] = []
    for (const paneKey of panes) {
      const row = this.state.lastStatusByPaneKey.get(paneKey)
      // Why: a Droid pane's session record outlives the Droid when another agent takes the pane.
      if (row && row.payload.agentType !== 'droid') {
        continue
      }
      // Why: a pane with no captured process cannot be proven gone, so it is never read as free.
      checks.push(
        row?.agentPresence?.process
          ? this.checkAgentPresence(paneKey)
          : Promise.resolve('unverifiable')
      )
    }
    const verdicts = await Promise.all(checks)
    if (verdicts.includes('live')) {
      return 'live'
    }
    return verdicts.includes('unverifiable') ? 'unverifiable' : null
  }

  checkAgentPresence(paneKey: string): Promise<AgentProcessVerdict | null> {
    const resolved = this.resolvePaneKeyAlias(paneKey)
    const row = this.state.lastStatusByPaneKey.get(resolved)
    // Why: an ended owner already published its exit, and an owner no hook identified cannot be checked.
    if (!row?.agentPresence?.process || row.agentPresence.ended) {
      return Promise.resolve(null)
    }
    if (row.connectionId !== null) {
      return Promise.resolve('unverifiable')
    }
    const pending = this.presenceChecks.get(row)
    if (pending) {
      return pending
    }
    const presence = row.agentPresence
    const check = probeAgentProcessPresence(presence.process)
      .then((verdict) => {
        if (
          this.state.lastStatusByPaneKey.get(resolved) !== row ||
          row.agentPresence !== presence
        ) {
          return 'unverifiable' as const
        }
        if (verdict === 'exited') {
          this.reconcileEndedProcessForPaneKeys([resolved], {
            preserveResumeIdentity: true,
            endedPresence: { ...presence, ended: true }
          })
        }
        return verdict
      })
      .finally(() => {
        if (this.presenceChecks.get(row) === check) {
          this.presenceChecks.delete(row)
        }
      })
    this.presenceChecks.set(row, check)
    return check
  }
}
