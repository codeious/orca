import { randomUUID } from 'node:crypto'
import {
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_EFFORT_OPTION_ID,
  DROID_SPEC_SAME_AS_MAIN
} from '../../shared/droid-spec-pair-options'
import { DroidMcpSignIn } from './droid-mcp-sign-in'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import { JsonlRpcSessionLifecycle } from '../jsonl-rpc/session-lifecycle'
import { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import { providerTimelineSink } from '../native-chat/agent-session-timeline/provider-timeline-plan'
import {
  AgentSessionPreSpawnError,
  type StructuredAgentSessionAdapter,
  type StructuredAgentSessionAcquireInput
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { DroidAgentConnection } from './droid-agent-connection'
import { droidAutonomyCapRow } from './droid-autonomy-cap-notice'
import { DroidContextUsage } from './droid-context-usage'
import {
  droidOptionParams,
  droidSavedOptionPicks,
  droidSpecPairParams
} from './droid-model-options'
import { DroidPrompts } from './droid-prompts'
import { DroidSessionModel } from './droid-session-model'
import { DroidSessionOptions } from './droid-session-options'
import { DroidReportedSettings, type DroidStartSettings } from './droid-session-settings'
import { readStartedSession } from './droid-started-session'
import { droidProviderLink, type DroidResolvedLaunch } from './droid-structured-launch-resolution'
import { DroidTurns } from './droid-turns'
import { continueDroidSession } from './droid-session-continuation'
import { isSupportedDroidProtocol } from './droid-version-support'
import { droidSpecHandoffHandlers } from './droid-spec-handoff'
import {
  readDroidCompactionSummary,
  type DroidCompactionSummaryReader
} from './droid-compaction-summary'

import type { DroidConnection, DroidSessionDeps } from './droid-session-deps'
export type { DroidConnection, DroidSessionDeps } from './droid-session-deps'

/** Where the child starts: a new Droid session in `cwd`, or the one `resumeId` names. A picked
 *  level was chosen in the chat; otherwise it is the one Agent Permissions asks for. */
type DroidSessionBegin = DroidStartSettings & {
  cwd: string
  resumeId: string | null
  autonomyPicked: boolean
  previous: DroidResolvedLaunch['previous']
}

const DROID_MACHINE_ID = 'orca'
const START_TIMEOUT_MS = 120_000

/** One child owns its transport, turns and timeline, including shutdown retries. */
export class DroidSession {
  readonly mcpSignIn = new DroidMcpSignIn()
  readonly connection: DroidConnection
  readonly lane: JsonlRpcTimelineLane
  readonly turns: DroidTurns
  readonly prompts: DroidPrompts
  private opening?: ReturnType<StructuredAgentSessionAdapter['open']>
  private readonly lifecycle: JsonlRpcSessionLifecycle
  /** What Droid last reported holding, merged from its partial `settings_updated` reports. */
  readonly settings = new DroidReportedSettings()
  /** What a no-pick new session resolved, for the host catalog. Absent when the start listed none. */
  readonly model = new DroidSessionModel()
  readonly options: DroidSessionOptions
  readonly context: DroidContextUsage
  readonly readCompactionSummary: (sessionId: string) => ReturnType<DroidCompactionSummaryReader>
  /** Droid's own id for the session this child holds, once the start has answered. */
  droidSessionId: string | undefined

  /** Every request after the start goes through here, so a method this Droid lacks reads alike. */
  readonly request: DroidConnection['request'] = (method, params, options) =>
    this.connection.request(method, params, options)

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
    const echoes = new Map<string, string>()
    this.readCompactionSummary = (id) =>
      (deps.readCompactionSummary ?? readDroidCompactionSummary)(launch, id)
    this.lane = new JsonlRpcTimelineLane({
      sink,
      sessionId,
      agent: 'droid',
      generation,
      namespace: sessionId,
      pauseReading: () => this.connection?.pauseReading(),
      resumeReading: () => this.connection?.resumeReading(),
      onFailed: (reason) => this.fail(new Error(reason)),
      onInputAccepted: (clientMessageId) => {
        const messageId = echoes.get(clientMessageId)
        echoes.delete(clientMessageId)
        this.lifecycle.settle(clientMessageId, {
          state: 'accepted',
          providerIdentity: messageId
            ? { provider: 'legacy', agent: 'droid', sessionId, recordId: messageId }
            : { provider: 'orca', clientMessageId }
        })
      }
    })
    this.lifecycle = new JsonlRpcSessionLifecycle({
      label: 'Droid',
      scope: 'droid',
      sessionId,
      fence: input.fence,
      generation,
      lane: this.lane,
      connection: () => this.connection,
      logger: deps.logger,
      onLifecycle: deps.onLifecycle,
      onSettled: deps.onSettled,
      endWork: () => {
        this.mcpSignIn.close()
        this.prompts.clear()
        this.turns.end()
      }
    })
    const handoffs = droidSpecHandoffHandlers(sessionId, deps.onSpecHandoff, (events) =>
      this.lane.apply(events)
    )
    this.prompts = new DroidPrompts(this.lane, {
      autonomyLevels: () => this.settings.current.availableAutonomyLevels,
      ...handoffs.environment
    })
    this.options = new DroidSessionOptions({
      request: this.request,
      settings: this.settings,
      model: this.model,
      requested: begin.interactionMode,
      ...(begin.autonomyPicked ? { pickedAutonomy: begin.autonomyLevel } : {}),
      timeoutMs: START_TIMEOUT_MS
    })
    this.context = new DroidContextUsage({
      request: this.request,
      apply: (events) => this.lane.apply(events),
      warn: (message, fields) =>
        deps.logger.warn(message, { scope: 'droid-context', sessionId, ...fields })
    })
    this.turns = new DroidTurns({
      rememberEcho: (clientId, messageId) => echoes.set(clientId, messageId),
      lane: this.lane,
      generation,
      request: this.request,
      settled: (id, outcome) => this.lifecycle.settle(id, outcome),
      idle: () => {
        this.context.refreshInBackground()
        deps.onIdle({ sessionId })
      },
      settings: (report) => this.settings.receive(report),
      specHandoff: handoffs.receive,
      warn: (message, fields) =>
        deps.logger.warn(message, { scope: 'droid-steer', sessionId, ...fields })
    })
    this.connection = (
      deps.openConnection ?? ((spec, handlers) => new DroidAgentConnection(spec, handlers))
    )(launch, {
      onNotification: (method, params) => this.notified(method, params),
      onRequest: (method, params, context) => this.prompts.handle(method, params, context),
      onClose: (error) => this.fail(error),
      onDiagnostic: (message) => deps.logger.warn(message, { scope: 'droid-rpc', sessionId }),
      onExit: (error) => this.lifecycle.observeExit(error)
    })
  }

  open(signal: AbortSignal): ReturnType<StructuredAgentSessionAdapter['open']> {
    this.opening ??= this.openProvider()
    return waitForPromiseWithSignal(this.opening, signal)
  }

  private async openProvider() {
    const id = await this.start()
    if (this.connection.closed) {
      throw new Error('Droid exited while opening')
    }
    const catalogListing = this.model.startListing
    return {
      link: droidProviderLink(this.begin, id, this.input.fence, randomUUID(), Date.now()),
      reportedOptions: {
        ...this.model.current,
        planMode: (this.settings.current.interactionMode ?? this.begin.interactionMode) === 'spec'
      },
      ...(catalogListing ? { catalogListing } : {})
    }
  }

  /** Droid's own id for the session this child now holds. Nothing else is sent before it answers. */
  async start(): Promise<string> {
    const { cwd, resumeId, autonomyLevel, interactionMode } = this.begin
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
            // The mode is Auto or Spec, never a Mission: those spend the person's credits unattended.
            {
              machineId: DROID_MACHINE_ID,
              cwd,
              interactionMode,
              autonomyLevel,
              ...droidOptionParams(saved),
              ...droidSpecPairParams(saved, false)
            },
            { timeoutMs: START_TIMEOUT_MS }
          ))
    } catch (error) {
      this.refuseUnsupportedProtocol(false)
      throw error
    }
    this.refuseUnsupportedProtocol(true)
    const resume = resumeId ? { id: resumeId, cwd, realpath: this.deps.realpath } : null
    const { id, settings } = await readStartedSession(result, resume)
    this.droidSessionId = id
    this.settings.adopt(settings)
    this.model.capture(result, saved, resumeId === null)
    let reportedLevel = this.settings.current.autonomyLevel
    if (resumeId) {
      reportedLevel = await this.options.resume(
        { autonomyLevel, interactionMode },
        saved,
        (error) =>
          this.deps.logger.warn('Droid did not take the saved model', {
            scope: 'droid-options',
            sessionId: this.input.identity.sessionId,
            error
          })
      )
    } else if (saved.specModel === null) {
      await this.options.set(DROID_SPEC_MODEL_OPTION_ID, DROID_SPEC_SAME_AS_MAIN)
    } else if (saved.specEffort === null) {
      await this.options.set(DROID_SPEC_EFFORT_OPTION_ID, DROID_SPEC_SAME_AS_MAIN)
    }
    // The row names Agent Permissions, so it is not said of a level the person picked in the chat.
    if (!this.begin.autonomyPicked) {
      this.lane.apply(droidAutonomyCapRow(autonomyLevel, reportedLevel))
    }
    return id
  }

  close(requested = true): ReturnType<DroidConnection['close']> {
    return this.lifecycle.close(requested)
  }

  continueIn = (id: string): Promise<void> =>
    continueDroidSession(
      this,
      {
        input: this.input,
        begin: this.begin,
        deps: this.deps,
        generation: this.generation
      },
      id
    )

  fail(error: Error): void {
    this.lifecycle.fail(error)
  }

  drainObservedExit(): Promise<void> {
    return this.lifecycle.drainObservedExit()
  }

  retire(): Promise<void> {
    return this.lifecycle.retire()
  }

  /** A release on another protocol major cannot run a chat; with no stamp seen there is no protocol. */
  private refuseUnsupportedProtocol(stampRequired: boolean): void {
    const version = this.connection.protocolVersion
    if (version === undefined ? stampRequired : !isSupportedDroidProtocol(version)) {
      throw new AgentSessionPreSpawnError(
        new Error('Droid reported an unsupported protocol version')
      )
    }
  }

  // The peer swallows a handler's throw, so a notification Droid sent that cannot be read ends the child.
  private notified(method: string, params: unknown): void {
    if (method !== 'droid.session_notification') {
      return
    }
    try {
      this.mcpSignIn.receive(params)
      this.context.receive(params)
      this.turns.receive(params)
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
