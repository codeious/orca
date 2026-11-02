import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { JsonlRpcSessionAdapter } from '../jsonl-rpc/session-adapter'
import { compactPiRpcSession } from './rpc-compaction'
import { buildPiRpcLaunch } from './rpc-launch'
import type { PiRpcResolvedLaunch } from './rpc-launch-resolution'
import { PiRpcSession, type PiRpcSessionDeps } from './rpc-session'
import { dispatchPiRpcMessage } from './rpc-message-dispatch'
import { applyPiRpcSessionOption } from './rpc-options'

export type PiRpcSessionAdapterDeps = PiRpcSessionDeps & {
  resolveLaunch: (input: {
    [K in 'identity' | 'spawnToken']: StructuredAgentSessionAcquireInput[K]
  }) => Promise<PiRpcResolvedLaunch>
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

  protected resolveLaunch(
    input: Pick<StructuredAgentSessionAcquireInput, 'identity' | 'spawnToken'>
  ): Promise<PiRpcResolvedLaunch> {
    return this.deps.resolveLaunch(input)
  }

  protected openSession(
    input: StructuredAgentSessionAcquireInput,
    launch: PiRpcResolvedLaunch,
    generation: string
  ): PiRpcSession {
    return new PiRpcSession(
      input,
      generation,
      buildPiRpcLaunch(launch),
      this.deps,
      launch,
      !launch.sessionFile && !launch.forkFile
    )
  }

  protected openProvider(session: PiRpcSession, signal: AbortSignal) {
    return session.open(signal)
  }

  protected withdrawPrompts(session: PiRpcSession): void {
    session.dialogs.cancelAll()
  }

  dispatch: StructuredAgentSessionAdapter['dispatch'] = async (input) => {
    const session = this.session(input.sessionId, input.fence)
    return dispatchPiRpcMessage(
      session,
      input,
      this.deps.logger,
      () => this.sessions.get(input.sessionId) === session
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
    return applyPiRpcSessionOption(
      session.connection,
      session.selected,
      input.key,
      input.value,
      { signal: input.signal },
      session.optionProof
    )
  }
  readOptions: NonNullable<StructuredAgentSessionAdapter['readOptions']> = async (input) =>
    this.session(input.sessionId, input.fence).readOptions()
  readCommands = (id: string) => this.sessions.get(id)?.startup.commands
  /** Pi's /name uses the owned running session; at-rest startup/teardown is not implemented. */
  renameProviderSession: NonNullable<StructuredAgentSessionAdapter['renameProviderSession']> =
    async ({ record, providerSessionId, name }) => {
      const session = this.sessions.get(record.sessionId)
      if (session?.connection.closed !== false) {
        return
      }
      if (session.openedLink?.handle.nativeId === providerSessionId) {
        await session.connection.request('set_session_name', { name }, { timeoutMs: 5_000 })
      }
    }

  protected override session(id: string, fence: number): PiRpcSession {
    const session = super.session(id, fence)
    if (!session.openedLink) {
      throw new Error('Pi session is not live under this fence')
    }
    return session
  }
}
