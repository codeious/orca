import type {
  AgentSessionDispatchOutcome,
  StructuredAgentSessionLifecycleEvent
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'
import type { ProviderProcessCloseResult } from '../provider-process/provider-process-close'
import type { JsonlRpcTimelineLane } from './timeline-lane'

const FINAL_TIMELINE_DRAIN_MS = 2_000

export type JsonlRpcSessionLifecycleOptions = {
  /** Names the agent in log lines, with `scope` as their prefix: `Pi` and `pi`. */
  label: string
  scope: string
  sessionId: string
  fence: number
  generation: string
  lane: Pick<JsonlRpcTimelineLane, 'finalize' | 'apply' | 'flush' | 'drained' | 'dispose'>
  /** A getter: the connection is opened after this, and its exit callbacks call back in. */
  connection: () => { close(): Promise<ProviderProcessCloseResult> }
  logger: StructuredAgentSessionLogger
  onLifecycle: (event: StructuredAgentSessionLifecycleEvent) => void
  onSettled: (input: {
    sessionId: string
    clientMessageId: string
    fence: number
    outcome: AgentSessionDispatchOutcome
  }) => void
  /** Ends what the child can no longer answer: its open prompts and its running turn. */
  endWork: () => void
  beforeClose?: () => void
}

/** What one JSON-RPC child owes the host: how it was closed, that it ended, and its settled input. */
export class JsonlRpcSessionLifecycle {
  private requestedClose = false
  private publishedExit = false
  private failedCause?: Error
  private exitDelivery: Promise<void> = Promise.resolve()
  private releaseAfterExit?: () => void

  constructor(private readonly options: JsonlRpcSessionLifecycleOptions) {}

  async close(requested = true): Promise<ProviderProcessCloseResult> {
    this.requestedClose ||= requested
    this.options.beforeClose?.()
    return this.options.connection().close()
  }

  fail(error: Error): void {
    const { label, scope, sessionId, logger } = this.options
    this.failedCause ??= error
    logger.error(`${label} RPC session failed`, { scope: `${scope}-rpc`, sessionId, error })
    void this.close(false)
      .then((result) => {
        if (result.root !== 'exited') {
          logger.warn(`${label} process exit is unverifiable`, {
            scope: `${scope}-stop`,
            sessionId
          })
        }
      })
      .catch((cause: unknown) =>
        logger.error(`${label} process cleanup failed`, {
          scope: `${scope}-stop`,
          sessionId,
          error: cause
        })
      )
  }

  /** The connection's exit callback. */
  observeExit(error: Error): void {
    const { label, scope, sessionId, logger } = this.options
    this.exitDelivery = this.publishExit(error)
      .catch((cause: unknown) =>
        logger.error(`${label} exit publication failed`, {
          scope: `${scope}-exit`,
          sessionId,
          error: cause
        })
      )
      .finally(() => this.releaseAfterExit?.())
  }

  drainObservedExit(): Promise<void> {
    return this.exitDelivery
  }

  /** Resolves once the end is published and the timeline has drained; the timeline is then disposed. */
  retire(): Promise<void> {
    const { lane } = this.options
    return new Promise((resolve) => {
      this.releaseAfterExit = () => {
        this.releaseAfterExit = undefined
        void lane.drained().then(() => {
          lane.dispose()
          resolve()
        })
      }
      if (this.publishedExit) {
        void this.exitDelivery.then(() => this.releaseAfterExit?.())
      }
    })
  }

  settle(clientMessageId: string, outcome: AgentSessionDispatchOutcome): void {
    const { sessionId, fence } = this.options
    this.options.onSettled({ sessionId, clientMessageId, fence, outcome })
  }

  private async publishExit(error: Error): Promise<void> {
    if (this.publishedExit) {
      return
    }
    this.publishedExit = true
    const { label, scope, sessionId, fence, generation, lane, logger } = this.options
    this.options.endWork()
    lane.finalize()
    lane.apply([
      { type: 'session.ended', verdict: { state: 'interrupted', completedAt: Date.now() } }
    ])
    lane.flush()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        lane.drained(),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            logger.warn(`${label} final timeline did not drain before exit publication`, {
              scope: `${scope}-exit-drain`,
              sessionId
            })
            resolve()
          }, FINAL_TIMELINE_DRAIN_MS)
          timer.unref()
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    this.options.onLifecycle({
      type: 'ended',
      sessionId,
      fence,
      acquisitionGeneration: generation,
      observedAt: Date.now(),
      cause: this.requestedClose ? 'requested-close' : 'unexpected-exit',
      reason: (this.failedCause ?? error).message
    })
  }
}
