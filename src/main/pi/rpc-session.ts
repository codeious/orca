import type {
  AgentSessionOptionsResult,
  AgentSessionSlashCommand
} from '../../shared/agent-session-wire'
import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionLifecycleEvent,
  AgentSessionDispatchOutcome
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'
import { providerTimelineSink } from '../native-chat/agent-session-timeline/provider-timeline-plan'
import { JsonlRpcSessionLifecycle } from '../jsonl-rpc/session-lifecycle'
import { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import {
  JsonlRpcAgentConnection,
  type JsonlRpcAgentConnectionOptions
} from '../jsonl-rpc/agent-connection'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { PiRpcTurns } from './rpc-turns'
import { PiRpcDialogCallbacks } from './rpc-dialog-callbacks'
import { piRpcStateSchema } from './rpc-protocol'
import { applyPiRpcSessionOption, readPiRpcCommands, readPiRpcSessionOptions } from './rpc-options'
import {
  unpickedSessionConfiguredChoice,
  withLiveCatalogListing,
  type AgentModelCatalogLiveListing
} from '../native-chat/agent-model-catalog/agent-model-catalog-entry'

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
  | 'lastCloseResult'
  | 'onExit'
>
export type PiRpcSessionDeps = {
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
  onIdle: (input: { sessionId: string }) => void
  logger: StructuredAgentSessionLogger
}

/** One child owns its transport, dialect, dialogs and timeline, including shutdown retries. */
export class PiRpcSession {
  readonly connection: PiRpcConnection
  readonly lane: JsonlRpcTimelineLane
  readonly turns: PiRpcTurns
  readonly dialogs: PiRpcDialogCallbacks
  readonly selected = new Map<string, string>()
  private startCatalogListing?: AgentModelCatalogLiveListing
  readonly skipped: string[] = []
  commands?: AgentSessionSlashCommand[]
  options?: AgentSessionOptionsResult
  private readonly lifecycle: JsonlRpcSessionLifecycle

  constructor(
    readonly input: StructuredAgentSessionAcquireInput,
    readonly generation: string,
    launch: ProviderProcessLaunch,
    private readonly deps: PiRpcSessionDeps,
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
      pauseReading: () => this.connection?.pauseReading(),
      resumeReading: () => this.connection?.resumeReading(),
      onFailed: (reason) => this.fail(new Error(reason)),
      onInputAccepted: (clientMessageId) =>
        this.lifecycle.settle(clientMessageId, {
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
      endWork: () => {
        this.dialogs.cancelAll()
        this.turns.end()
      },
      beforeClose: () => this.dialogs.cancelAll()
    })
    this.turns = new PiRpcTurns({
      lane: this.lane,
      generation,
      send: (frame) => this.connection.send(frame),
      request: (command, params, options) => this.connection.request(command, params, options),
      settled: (id, outcome) => this.lifecycle.settle(id, outcome),
      idle: () => {
        this.dialogs.cancelAll()
        deps.onIdle({ sessionId: input.identity.sessionId })
      },
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
      ...(input.onOutput ? { onOutput: input.onOutput } : {}),
      onRecord: (frame) =>
        frame.type === 'extension_ui_request'
          ? this.dialogs.receive(frame)
          : this.turns.receive(frame),
      onClose: (error) => this.fail(error),
      onDiagnostic: (message) =>
        deps.logger.warn(message, { scope: 'pi-rpc', sessionId: input.identity.sessionId }),
      onExit: (error) => this.lifecycle.observeExit(error)
    })
  }

  async start(): Promise<string> {
    const state = piRpcStateSchema.parse(await this.connection.request('get_state'))
    this.lane.apply(this.turns.context.setModel(state.model ?? undefined, Date.now()))
    // Keys a restore sent, whether or not Pi took them.
    const picked = new Set<string>()
    for (const [key, value] of Object.entries(this.input.options ?? {})) {
      if (!['model', 'effort'].includes(key)) {
        this.skipped.push(key)
        continue
      }
      picked.add(key)
      try {
        await applyPiRpcSessionOption(this.connection, this.selected, key, value)
      } catch (error) {
        this.skipped.push(key)
        this.deps.logger.warn('Pi rejected a saved option', {
          scope: 'pi-option-restore',
          sessionId: this.input.identity.sessionId,
          key,
          error
        })
      }
    }
    this.options = await readPiRpcSessionOptions(this.connection)
    this.startCatalogListing = withLiveCatalogListing(
      this.options,
      unpickedSessionConfiguredChoice({
        resolvesConfig: this.resolvesConfig,
        picked,
        ...this.options
      })
    ).catalogListing
    try {
      this.commands = (await readPiRpcCommands(this.connection)).commands
    } catch (error) {
      this.deps.logger.warn('Pi commands could not be read', {
        scope: 'pi-commands',
        sessionId: this.input.identity.sessionId,
        error
      })
    }
    return state.sessionFile
  }

  /** What this child listed at its start, with what its config resolved; the host saves it once. */
  get startListing(): AgentModelCatalogLiveListing | undefined {
    return this.startCatalogListing
  }

  /** What the child reports now; only the start says what its config resolved. */
  async readOptions() {
    return withLiveCatalogListing(await readPiRpcSessionOptions(this.connection))
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
}
