import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionLifecycleEvent,
  AgentSessionDispatchOutcome
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'
import { providerTimelineSink } from '../native-chat/agent-session-timeline/provider-timeline-plan'
import { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import { ReaderPauseHolds } from '../jsonl-rpc/reader-pause-holds'
import {
  JsonlRpcAgentConnection,
  type JsonlRpcAgentConnectionOptions
} from '../jsonl-rpc/agent-connection'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { piExitFailure } from './rpc-exit-classification'
import { PiRpcTurns } from './rpc-turns'
import { PiRpcDialogCallbacks } from './rpc-dialog-callbacks'
import { PiRpcOptionObservations, type PiRpcOptionWrite } from './rpc-options'
import type { PiRpcResolvedLaunch } from './rpc-launch-resolution'
import type { StructuredAgentSessionProviderOpenResult } from '../native-chat/agent-session-wire/structured-agent-session-provider-open-contract'
import type { AgentSessionProviderHandleLink } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { PiRpcSessionStartup } from './rpc-session-startup'
import { PiHistoryCapture, type PiHistoryCaptureDeps } from './rpc-history-capture'
import { JsonlRpcSessionLifecycle } from '../jsonl-rpc/session-lifecycle'

export type PiRpcConnection = Pick<
  JsonlRpcAgentConnection,
  | 'request'
  | 'send'
  | 'close'
  | 'pauseReading'
  | 'resumeReading'
  | 'pid'
  | 'closed'
  | 'rootVerdict'
  | 'processless'
  | 'spawnAbsence'
  | 'lastCloseResult'
  | 'onExit'
>
export type PiRpcSessionDeps = PiHistoryCaptureDeps & {
  openConnection?: (
    launch: ProviderProcessLaunch,
    handlers: JsonlRpcAgentConnectionOptions
  ) => PiRpcConnection
  onLifecycle: (event: StructuredAgentSessionLifecycleEvent) => void
  onSettled: (input: {
    sessionId: string
    clientMessageId: string
    fence: number
    outcome: AgentSessionDispatchOutcome
  }) => void
  logger: StructuredAgentSessionLogger
}

export class PiRpcSession {
  readonly connection: PiRpcConnection
  readonly lane: JsonlRpcTimelineLane
  readonly turns: PiRpcTurns
  readonly dialogs: PiRpcDialogCallbacks
  readonly selected = new Map<string, string>()
  /** Hold sends from handover through settlement. */
  readonly heldSends = new Set<string>()
  readonly optionProof = {
    current: new Map<string, string>(),
    writes: new Map<string, PiRpcOptionWrite>()
  }
  private optionObservations = new PiRpcOptionObservations(
    this.optionProof,
    () => !this.requestedClose && !this.lifecycle.failureCause && !this.connection.closed
  )
  readonly startup: PiRpcSessionStartup
  readonly history = PiHistoryCapture.forSession(this, () => this.deps)
  openedLink: AgentSessionProviderHandleLink | null = null
  private readonly reading = new ReaderPauseHolds<'lane' | 'journal'>(() => this.connection)
  private unbindReadingControl?: () => void
  private readonly lifecycle: JsonlRpcSessionLifecycle

  get requestedClose(): boolean {
    return this.lifecycle.closeRequested
  }

  constructor(
    readonly input: StructuredAgentSessionAcquireInput,
    readonly generation: string,
    launch: ProviderProcessLaunch,
    private readonly deps: PiRpcSessionDeps,
    private readonly resolvedLaunch: PiRpcResolvedLaunch,
    /** A new Pi session starts on its config's model; a resumed or forked one keeps its own. */
    readonly resolvesConfig = false
  ) {
    const sink = input.events && providerTimelineSink(input.events)
    if (!sink) {
      throw new Error('Pi structured chat requires the shared timeline sink')
    }
    this.lane = new JsonlRpcTimelineLane({
      sink,
      sessionId: input.identity.sessionId,
      agent: 'pi',
      generation,
      namespace: input.identity.sessionId,
      ...this.reading.control('lane'),
      onFailed: (reason) => this.fail(new Error(reason)),
      onInputAccepted: (clientMessageId) =>
        this.settle(clientMessageId, {
          state: 'accepted',
          providerIdentity: { provider: 'orca', clientMessageId }
        })
    })
    this.lifecycle = new JsonlRpcSessionLifecycle({
      label: 'Pi',
      scope: 'pi',
      sessionId: input.identity.sessionId,
      fence: input.fence,
      generation,
      lane: this.lane,
      connection: () => this.connection,
      logger: deps.logger,
      onLifecycle: deps.onLifecycle,
      onSettled: deps.onSettled,
      beforeClose: () => this.dialogs.cancelAll(),
      canCloseOnFailure: () => Boolean(this.openedLink),
      onExitObserved: (at) => input.events?.observeExit?.(this.heldSends, at),
      failure: piExitFailure,
      // Final transfer must not treat an already received backlog as startup work.
      afterFinalDrain: () => this.unbindReadingControl?.(),
      endWork: () => {
        this.dialogs.cancelAll()
        this.turns.end()
      }
    })
    this.turns = new PiRpcTurns({
      lane: this.lane,
      generation,
      send: (frame) => this.connection.send(frame),
      request: (command, params, options) => this.connection.request(command, params, options),
      prepareStateObservation: () =>
        this.optionObservations.prepareState((current) =>
          this.startup.reportOptions(generation, current)
        ),
      settled: (id, outcome) => this.settle(id, outcome),
      idle: () => this.dialogs.cancelAll(),
      turnEnded: () => this.history.turnEnded(),
      failed: (error) => this.fail(error),
      diagnostic: (error) =>
        deps.logger.warn('Pi context usage could not be read', {
          scope: 'pi-context-usage',
          sessionId: input.identity.sessionId,
          error
        })
    })
    this.dialogs = new PiRpcDialogCallbacks(
      this.lane,
      (frame) => this.connection.send(frame),
      (error) => this.fail(error)
    )
    this.connection = (
      deps.openConnection ?? ((spec, handlers) => new JsonlRpcAgentConnection(spec, handlers))
    )(launch, {
      onRecord: (frame) =>
        frame.type === 'extension_ui_request'
          ? this.dialogs.receive(frame)
          : this.turns.receive(frame),
      onOversizedEvent: (type, prefix) => this.turns.skipped(type, prefix),
      onClose: (error) => this.fail(error),
      onDiagnostic: (message) =>
        deps.logger.warn(message, { scope: 'pi-rpc', sessionId: input.identity.sessionId }),
      onExit: (error) => this.lifecycle.observeExit(error)
    })
    this.startup = new PiRpcSessionStartup(
      input,
      this.connection,
      deps,
      resolvesConfig,
      (state) => {
        this.lane.apply(this.turns.context.setModel(state.model ?? undefined, Date.now()))
        this.optionObservations.seed(state)
      },
      () => this.lifecycle.failureCause,
      () => this.optionObservations.prepare()
    )
  }

  async submit(...args: Parameters<PiRpcTurns['submit']>): ReturnType<PiRpcTurns['submit']> {
    const [clientMessageId] = args
    this.heldSends.add(clientMessageId)
    let outcome: AgentSessionDispatchOutcome | undefined
    try {
      return (outcome = await this.turns.submit(...args))
    } finally {
      if (outcome?.state !== 'admitted') {
        this.heldSends.delete(clientMessageId)
      }
    }
  }

  async open(signal: AbortSignal): Promise<StructuredAgentSessionProviderOpenResult> {
    const result = await this.startup.run(this.resolvedLaunch, signal)
    // Startup replies stay readable; journal pressure paces only later output.
    if (!this.lifecycle.exitPublished) {
      this.unbindReadingControl = this.input.events?.bindReadingControl?.(
        this.reading.control('journal')
      )
    }
    this.openedLink = result.link ?? null
    this.history.start(this.startup.historyAnchor)
    this.startup.reportAfterOpen(this.generation, result.reportedOptions)
    return result
  }

  /** A read projects this child's held observations and successful controls. */
  async readOptions() {
    return this.optionObservations.read()
  }

  close(requested = true): ReturnType<PiRpcConnection['close']> {
    return this.lifecycle.close(requested)
  }

  fail(error: Error): void {
    this.lifecycle.fail(error)
  }

  drainObservedExit(): Promise<void> {
    return this.lifecycle.drainObservedExit()
  }

  retire(): Promise<void> {
    return this.lifecycle.retire()
  }

  private settle(clientMessageId: string, outcome: AgentSessionDispatchOutcome): void {
    this.heldSends.delete(clientMessageId)
    this.lifecycle.settle(clientMessageId, outcome)
  }
}
