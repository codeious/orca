import { CodexSubagentPollScheduler } from './codex-subagent-poll-scheduler'
import type { AgentProcessVerdict } from './agent-process-presence'

export const AGENT_EXIT_WATCH_FIRST_PROBE_MS = 250
export const AGENT_EXIT_WATCH_MAX_PROBE_MS = 8_000
export const AGENT_EXIT_WATCH_WINDOW_MS = 90_000

export type AgentExitWatchHost = {
  /** False once the pane no longer holds what the watch was started for. */
  isCurrent: () => boolean
  /** One liveness check; `exited` must already have ended the row, `null` means nothing to check. */
  probe: () => Promise<AgentProcessVerdict | null>
}

type Watch = AgentExitWatchHost & { delayMs: number; waitedMs: number }

/**
 * Confirms that an agent which announced its end has really exited. The announcement is not proof
 * (a `/clear` also ends a session), so the host asks the process itself, quickly at first and
 * then less often, and leaves the row alone if the process outlives the window.
 */
export class AgentProcessExitWatch {
  private readonly watches = new Map<string, Watch>()
  private readonly wakeups = new CodexSubagentPollScheduler<Watch>(
    AGENT_EXIT_WATCH_FIRST_PROBE_MS,
    (key, watch) => this.probe(key, watch)
  )

  start(key: string, host: AgentExitWatchHost): void {
    const watch: Watch = { ...host, delayMs: AGENT_EXIT_WATCH_FIRST_PROBE_MS, waitedMs: 0 }
    this.watches.set(key, watch)
    this.wakeups.schedule(key, watch)
  }

  stop(key: string): void {
    this.watches.delete(key)
    this.wakeups.clear(key)
  }

  stopAll(): void {
    this.watches.clear()
    this.wakeups.clearAll()
  }

  private probe(key: string, watch: Watch): void {
    if (this.watches.get(key) !== watch || !watch.isCurrent()) {
      this.watches.delete(key)
      return
    }
    watch.waitedMs += watch.delayMs
    void watch.probe().then(
      (verdict) => {
        const next = Math.min(watch.delayMs * 2, AGENT_EXIT_WATCH_MAX_PROBE_MS)
        // Why: a probe that settles after stop() or a restart belongs to a watch nobody holds.
        if (
          this.watches.get(key) !== watch ||
          verdict === 'exited' ||
          verdict === null ||
          watch.waitedMs + next > AGENT_EXIT_WATCH_WINDOW_MS
        ) {
          if (this.watches.get(key) === watch) {
            this.watches.delete(key)
          }
          return
        }
        watch.delayMs = next
        this.wakeups.schedule(key, watch, next)
      },
      () => {
        if (this.watches.get(key) === watch) {
          this.watches.delete(key)
        }
      }
    )
  }
}
