import type { AgentSessionUnavailable } from '../../shared/agent-session-availability'
import { agentSessionFailureFact } from '../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../shared/agent-session-failure-words'
import { JsonlRpcSessionAdapter } from '../jsonl-rpc/session-adapter'
import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { compactPiRpcSession } from './rpc-compaction'
import { buildPiRpcLaunch } from './rpc-launch'
import { piRpcProviderLink, type PiRpcResolvedLaunch } from './rpc-launch-resolution'
import { PiRpcSession, type PiRpcSessionDeps } from './rpc-session'
import { PiRpcPromptError, preparePiRpcPrompt } from './rpc-prompt'
import { applyPiRpcSessionOption } from './rpc-options'
import { ClaudeDispatchContentError } from '../claude/claude-structured-dispatch-content'

export type PiRpcSessionAdapterDeps = PiRpcSessionDeps & {
  resolveLaunch: (
    identity: StructuredAgentSessionAcquireInput['identity']
  ) => Promise<PiRpcResolvedLaunch>
  readProcessStartTime?: (pid: number) => Promise<number | null>
}

export class PiRpcSessionAdapter
  extends JsonlRpcSessionAdapter<PiRpcSession, PiRpcResolvedLaunch>
  implements StructuredAgentSessionAdapter
{
  protected readonly interruptMethod = 'abort'

  constructor(private readonly deps: PiRpcSessionAdapterDeps) {
    super({ agent: 'pi', label: 'Pi', spawnLabel: 'Pi RPC' }, deps.readProcessStartTime)
  }

  protected resolveLaunch(identity: StructuredAgentSessionAcquireInput['identity']) {
    return this.deps.resolveLaunch(identity)
  }

  protected openSession(
    input: StructuredAgentSessionAcquireInput,
    launch: PiRpcResolvedLaunch,
    generation: string
  ): PiRpcSession {
    const spec = buildPiRpcLaunch({
      ...launch,
      structuredSession: { id: input.identity.sessionId, spawnToken: input.spawnToken }
    })
    const fresh = !launch.sessionFile && !launch.forkFile
    return new PiRpcSession(input, generation, spec, this.deps, fresh)
  }

  protected link = piRpcProviderLink

  protected startListing(session: PiRpcSession) {
    return session.startListing
  }

  protected withdrawPrompts(session: PiRpcSession): void {
    session.dialogs.cancelAll()
  }

  dispatch: StructuredAgentSessionAdapter['dispatch'] = async (input) => {
    const session = this.session(input.sessionId, input.fence)
    let prompt
    try {
      prompt = await preparePiRpcPrompt(input.body)
    } catch (error) {
      this.deps.logger.warn('Pi prompt could not be prepared', {
        scope: 'pi-prompt',
        sessionId: input.sessionId,
        error
      })
      return {
        state: 'rejected',
        ...agentSessionFailureWords(
          error instanceof PiRpcPromptError || error instanceof ClaudeDispatchContentError
            ? error.failure
            : agentSessionFailureFact('attachmentUnreadable'),
          { agentName: 'Pi', surface: 'rejection' }
        )
      }
    }
    return session.turns.submit(
      input.clientMessageId,
      input.requestedAt ?? Date.now(),
      { ...prompt },
      input.beforeDispatch
    )
  }

  compact: NonNullable<StructuredAgentSessionAdapter['compact']> = async (input) =>
    compactPiRpcSession(this.session(input.sessionId, input.fence), input.command)

  awaitStoppedRequestEnd: NonNullable<StructuredAgentSessionAdapter['awaitStoppedRequestEnd']> =
    async (id, at) => {
      const session = this.sessions.get(id)
      const turn = session?.lane.openTurnId
      if (!session) {
        return
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        if (turn) {
          await Promise.race([
            session.lane.whenTurnLeaves(turn),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, Math.max(0, at + 2_000 - Date.now()))
              timer.unref()
            })
          ])
        }
      } finally {
        clearTimeout(timer)
      }
      try {
        await session.connection.request('get_state', {}, { timeoutMs: 1_000 })
      } catch (error) {
        this.deps.logger.warn('Pi checkpoint could not be read before stopping', {
          scope: 'pi-stop-checkpoint',
          sessionId: id,
          error
        })
      }
    }
  dismissPrompt: NonNullable<StructuredAgentSessionAdapter['dismissPrompt']> = (input) =>
    this.session(input.sessionId, input.fence).dialogs.respond(
      input.itemId,
      null,
      input.commit,
      input.answer
    )
  answerPrompt: StructuredAgentSessionAdapter['answerPrompt'] = (input) =>
    this.session(input.sessionId, input.fence).dialogs.respond(
      input.itemId,
      input.response,
      input.commit
    )
  setOption: StructuredAgentSessionAdapter['setOption'] = (input) => {
    const session = this.session(input.sessionId, input.fence)
    return applyPiRpcSessionOption(session.connection, session.selected, input.key, input.value)
  }
  readOptions: NonNullable<StructuredAgentSessionAdapter['readOptions']> = async (input) =>
    this.session(input.sessionId, input.fence).readOptions()
  readCommands = (id: string) => this.sessions.get(id)?.commands
  readOptionRestoreFailures(id: string): readonly string[] {
    return this.sessions.get(id)?.skipped ?? []
  }
  /** Started with no model listed: Pi keeps a placeholder, so every prompt this child takes fails
   *  as not signed in, even after a sign-in, which only a new Pi reads. */
  startUnavailable(id: string): AgentSessionUnavailable | undefined {
    const session = this.sessions.get(id)
    return session &&
      !session.connection.closed &&
      session.connection.rootVerdict !== 'exited' &&
      session.options?.models.length === 0
      ? { reason: 'notSignedIn' }
      : undefined
  }
}
