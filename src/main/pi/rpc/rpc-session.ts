import type { PiRpcConnection, PiRpcSessionDeps } from './rpc-session-contracts'
import type { ProviderProcessLaunch } from '../../provider-process/provider-process-launch'
import { withStructuredHistoryInvocation } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-history-invocation'
import type {
  StructuredAgentSessionAcquireInput,
  AgentSessionDispatchOutcome
} from '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { providerTimelineSink } from '../../native-chat/agent-session-timeline/provider-timeline-plan'
import { JsonlRpcTimelineLane } from '../../jsonl-rpc/timeline-lane'
import { ReaderPauseHolds } from '../../jsonl-rpc/reader-pause-holds'
import { JsonlRpcAgentConnection } from '../../jsonl-rpc/agent-connection'
import { piExitFailure } from './rpc-exit-classification'
import { PiRpcTurns } from './rpc-turns'
import { PI_RPC_PEER_OPTIONS } from './prompts/rpc-prompt'
import { PiRpcDialogCallbacks } from './rpc-dialog-callbacks'
import { PiRpcOptionObservations, type PiRpcOptionWrite } from './options/rpc-options'
import type { PiRpcResolvedLaunch } from './launch/rpc-launch-resolution'
import type { StructuredAgentSessionProviderOpenResult } from '../../native-chat/agent-session-wire/startup/structured-agent-session-provider-open-contract'
import type { AgentSessionProviderHandleLink } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import { PiRpcSessionStartup } from './rpc-session-startup'
import { PiHistoryCapture } from './history/rpc-history-capture'
import { JsonlRpcSessionLifecycle } from '../../jsonl-rpc/session-lifecycle'

export type { PiRpcConnection, PiRpcSessionDeps } from './rpc-session-contracts'

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
    () => !this.requestedClose && !this.failure && !this.connection.closed
  )
  readonly startup: PiRpcSessionStartup
  readonly history = PiHistoryCapture.forSession(this, () => this.deps)
  openedLink: AgentSessionProviderHandleLink | null = null
  historyCatchUp?: AbortController
  private readonly startupFailure = Promise.withResolvers<never>()
  private readonly reading = new ReaderPauseHolds<'lane' | 'journal'>(() => this.connection)
  private unbindReadingControl?: () => void
  private readonly lifecycle: JsonlRpcSessionLifecycle

  get requestedClose(): boolean {
    return this.lifecycle.closeRequested
  }

  /** What ended this child, once something did. */
  get failure(): Error | undefined {
    return this.lifecycle.failureCause
  }

  get shrinksImages(): boolean {
    return this.resolvedLaunch.shrinksImages === true
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
    void this.startupFailure.promise.catch(() => {})
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
      onLifecycle: (event) => deps.onLifecycle(event),
      onSettled: (settled) => deps.onSettled(settled),
      beforeClose: () => this.dialogs.cancelAll(),
      canCloseOnFailure: () => Boolean(this.openedLink),
      onExitObserved: (at, error) => {
        this.historyCatchUp?.abort(error)
        input.events?.observeExit?.(this.heldSends, at)
      },
      failure: piExitFailure,
      // Final transfer must not treat an already received backlog as startup work.
      afterFinalDrain: () => this.unbindReadingControl?.(),
      endWork: () => {
        this.dialogs.close()
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
      (error) => this.fail(error),
      resolvedLaunch.backgroundWork?.directory ?? null,
      (evidence) => deps.onChildWorkEvidence?.(input.identity.sessionId, evidence, input.events)
    )
    this.connection = (
      deps.openConnection ?? ((spec, handlers) => new JsonlRpcAgentConnection(spec, handlers))
    )(launch, {
      peer: PI_RPC_PEER_OPTIONS,
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
      () => this.failure,
      this.startupFailure.promise,
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
    this.startup.assertLive(signal)
    const result = await withStructuredHistoryInvocation(this, signal, (current) =>
      this.startup.run(this.resolvedLaunch, current)
    )
    this.startup.assertLive(signal)
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
    this.historyCatchUp?.abort()
    return this.lifecycle.close(requested)
  }

  fail(error: Error): void {
    this.historyCatchUp?.abort(error)
    this.startupFailure.reject(this.lifecycle.failureCause ?? error)
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
