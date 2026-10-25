import { z } from 'zod'
import { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import { providerTimelineSink } from '../native-chat/agent-session-timeline/provider-timeline-plan'
import {
  AgentSessionPreSpawnError,
  type AgentSessionDispatchOutcome,
  type StructuredAgentSessionAcquireInput,
  type StructuredAgentSessionLifecycleEvent
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { DroidAgentConnection, type DroidAgentConnectionOptions } from './droid-agent-connection'
import { droidOptionParams, droidSavedOptionPicks } from './droid-model-options'
import { DroidSessionModel } from './droid-session-model'
import { DroidTurns } from './droid-turns'
import { isSupportedDroidProtocol } from './droid-version-support'

export type DroidConnection = Pick<
  DroidAgentConnection,
  | 'request'
  | 'close'
  | 'pauseReading'
  | 'resumeReading'
  | 'pid'
  | 'closed'
  | 'rootVerdict'
  | 'processless'
  | 'lastCloseResult'
  | 'onExit'
  | 'protocolVersion'
>

export type DroidSessionDeps = {
  openConnection?: (
    launch: ProviderProcessLaunch,
    handlers: DroidAgentConnectionOptions
  ) => DroidConnection
  onLifecycle: (event: StructuredAgentSessionLifecycleEvent) => void
  onSettled: (input: {
    sessionId: string
    clientMessageId: string
    fence: number
    outcome: AgentSessionDispatchOutcome
  }) => void
  onIdle: (input: { sessionId: string }) => void
  logger: StructuredAgentSessionLogger
}

/** Where the child starts: a new Droid session in `cwd`, or the one `resumeId` names. */
export type DroidSessionBegin = { cwd: string; resumeId: string | null }

export const DROID_MACHINE_ID = 'orca'
const START_TIMEOUT_MS = 120_000
// `initialize_session` names the session beside a `session` that carries only its messages.
const startedSchema = z.looseObject({
  sessionId: z.string().min(1).optional(),
  session: z.looseObject({ id: z.string().min(1).optional() }).optional()
})

/** One child owns its transport, turns and timeline, including shutdown retries. */
export class DroidSession {
  readonly connection: DroidConnection
  readonly lane: JsonlRpcTimelineLane
  readonly turns: DroidTurns
  requestedClose = false
  /** What a no-pick new session resolved, for the host catalog. Absent when the start listed none. */
  readonly model = new DroidSessionModel()
  private publishedExit = false
  private failedCause?: Error
  private exitDelivery: Promise<void> = Promise.resolve()
  private releaseAfterExit?: () => void

  constructor(
    readonly input: StructuredAgentSessionAcquireInput,
    readonly generation: string,
    launch: ProviderProcessLaunch,
    private readonly deps: DroidSessionDeps,
    private readonly begin: DroidSessionBegin
  ) {
    const sink = input.events && providerTimelineSink(input.events)
    if (!sink) {
      throw new Error('Droid structured chat requires the shared timeline sink')
    }
    const sessionId = input.identity.sessionId
    this.lane = new JsonlRpcTimelineLane({
      sink,
      sessionId,
      agent: 'droid',
      generation,
      namespace: sessionId,
      pauseReading: () => this.connection?.pauseReading(),
      resumeReading: () => this.connection?.resumeReading(),
      onFailed: (reason) => this.fail(new Error(reason)),
      onInputAccepted: (clientMessageId) =>
        this.settle(clientMessageId, {
          state: 'accepted',
          providerIdentity: { provider: 'orca', clientMessageId }
        })
    })
    this.turns = new DroidTurns({
      lane: this.lane,
      generation,
      request: (method, params, options) => this.connection.request(method, params, options),
      settled: (id, outcome) => this.settle(id, outcome),
      idle: () => deps.onIdle({ sessionId })
    })
    this.connection = (
      deps.openConnection ?? ((spec, handlers) => new DroidAgentConnection(spec, handlers))
    )(launch, {
      ...(input.onOutput ? { onOutput: input.onOutput } : {}),
      onNotification: (method, params) => this.notified(method, params),
      onClose: (error) => this.fail(error),
      onDiagnostic: (message) => deps.logger.warn(message, { scope: 'droid-rpc', sessionId }),
      onExit: (error) => {
        this.exitDelivery = this.exit(error)
          .catch((cause: unknown) =>
            deps.logger.error('Droid exit publication failed', {
              scope: 'droid-exit',
              sessionId,
              error: cause
            })
          )
          .finally(() => this.releaseAfterExit?.())
      }
    })
  }

  /** Droid's own id for the session this child now holds. Nothing else is sent before it answers. */
  async start(): Promise<string> {
    const { cwd, resumeId } = this.begin
    const saved = droidSavedOptionPicks(this.input.options)
    let result: unknown
    try {
      result = await (resumeId
        ? this.connection.request(
            'droid.load_session',
            { sessionId: resumeId },
            { timeoutMs: START_TIMEOUT_MS }
          )
        : this.connection.request(
            'droid.initialize_session',
            // Never a Mission: those spend the person's credits unattended.
            {
              machineId: DROID_MACHINE_ID,
              cwd,
              interactionMode: 'auto',
              autonomyLevel: 'off',
              ...droidOptionParams(saved)
            },
            { timeoutMs: START_TIMEOUT_MS }
          ))
    } catch (error) {
      this.refuseUnsupportedProtocol(false)
      throw error
    }
    this.refuseUnsupportedProtocol(true)
    const parsed = startedSchema.safeParse(result)
    // A load answers with the session's content, never its id, so the one asked for is the one held.
    const id = parsed.success
      ? (parsed.data.sessionId ?? parsed.data.session?.id ?? resumeId ?? undefined)
      : undefined
    if (!id) {
      throw new Error('Droid did not name its session')
    }
    this.model.capture(result, saved, resumeId === null)
    if (resumeId) {
      await this.model.applySaved(
        (method, params, options) => this.connection.request(method, params, options),
        saved,
        (error) =>
          this.deps.logger.warn('Droid did not take the saved model', {
            scope: 'droid-options',
            sessionId: this.input.identity.sessionId,
            error
          })
      )
    }
    return id
  }

  readOptions(): ReturnType<DroidSessionModel['read']> {
    return this.model.read((method, params, options) =>
      this.connection.request(method, params, options)
    )
  }

  setOption(key: string, value: string): ReturnType<DroidSessionModel['set']> {
    return this.model.set(
      (method, params, options) => this.connection.request(method, params, options),
      key,
      value
    )
  }

  async close(requested = true): ReturnType<DroidConnection['close']> {
    this.requestedClose ||= requested
    return this.connection.close()
  }

  fail(error: Error): void {
    this.failedCause ??= error
    this.deps.logger.error('Droid session failed', {
      scope: 'droid-rpc',
      sessionId: this.input.identity.sessionId,
      error
    })
    void this.close(false)
      .then((result) => {
        if (result.root !== 'exited') {
          this.deps.logger.warn('Droid process exit is unverifiable', {
            scope: 'droid-stop',
            sessionId: this.input.identity.sessionId
          })
        }
      })
      .catch((cause: unknown) =>
        this.deps.logger.error('Droid process cleanup failed', {
          scope: 'droid-stop',
          sessionId: this.input.identity.sessionId,
          error: cause
        })
      )
  }

  drainObservedExit(): Promise<void> {
    return this.exitDelivery
  }

  retire(): Promise<void> {
    return new Promise((resolve) => {
      this.releaseAfterExit = () => {
        this.releaseAfterExit = undefined
        void this.lane.drained().then(() => {
          this.lane.dispose()
          resolve()
        })
      }
      if (this.publishedExit) {
        void this.exitDelivery.then(() => this.releaseAfterExit?.())
      }
    })
  }

  /** A release on another protocol major cannot run a chat; with no stamp seen there is no protocol. */
  private refuseUnsupportedProtocol(stampRequired: boolean): void {
    const version = this.connection.protocolVersion
    if (version === undefined ? stampRequired : !isSupportedDroidProtocol(version)) {
      throw AgentSessionPreSpawnError.unsupportedRelease()
    }
  }

  // The peer swallows a handler's throw, so a notification Droid sent that cannot be read ends the child.
  private notified(method: string, params: unknown): void {
    if (method !== 'droid.session_notification') {
      return
    }
    try {
      this.turns.receive(params)
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async exit(error: Error): Promise<void> {
    if (this.publishedExit) {
      return
    }
    this.publishedExit = true
    this.turns.end()
    this.lane.finalize()
    this.lane.apply([
      { type: 'session.ended', verdict: { state: 'interrupted', completedAt: Date.now() } }
    ])
    this.lane.flush()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.lane.drained(),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.deps.logger.warn('Droid final timeline did not drain before exit publication', {
              scope: 'droid-exit-drain',
              sessionId: this.input.identity.sessionId
            })
            resolve()
          }, 2_000)
          timer.unref()
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    this.deps.onLifecycle({
      type: 'ended',
      sessionId: this.input.identity.sessionId,
      fence: this.input.fence,
      acquisitionGeneration: this.generation,
      observedAt: Date.now(),
      cause: this.requestedClose ? 'requested-close' : 'unexpected-exit',
      reason: (this.failedCause ?? error).message
    })
  }

  private settle(clientMessageId: string, outcome: AgentSessionDispatchOutcome): void {
    this.deps.onSettled({
      sessionId: this.input.identity.sessionId,
      clientMessageId,
      fence: this.input.fence,
      outcome
    })
  }
}
