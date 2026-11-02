import { agentSessionFailureWords } from '../../shared/agent-session/failures/agent-session-failure-words'
import { droidAutonomyLevelFromSavedOptions } from '../../shared/droid-autonomy-options'
import { decodeStructuredAgentSessionOptionValue } from '../../shared/agent-session/options/structured-agent-session-option-codec'
import { JsonlRpcSessionAdapter } from '../jsonl-rpc/session-adapter'
import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  AgentSessionOptionRejectedError,
  isAgentSessionOptionRejectedError
} from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { isAgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter-errors'
import { buildDroidExecLaunch } from './droid-exec-launch'
import { prepareDroidPrompt } from './droid-prompt'
import { DroidSession, type DroidSessionDeps } from './droid-session'
import { droidInteractionModeFromSavedOptions } from './droid-session-settings'
import type { DroidResolvedLaunch } from './droid-structured-launch-resolution'

export type DroidSessionAdapterDeps = DroidSessionDeps & {
  resolveLaunch: (
    identity: StructuredAgentSessionAcquireInput['identity']
  ) => Promise<DroidResolvedLaunch>
  readProcessStartTime?: (pid: number) => Promise<number | null>
}

export class DroidSessionAdapter
  extends JsonlRpcSessionAdapter<DroidSession, DroidResolvedLaunch>
  implements StructuredAgentSessionAdapter
{
  protected readonly interruptMethod = 'droid.interrupt_session'

  stopEndsSession(): boolean {
    return true
  }

  constructor(private readonly deps: DroidSessionAdapterDeps) {
    super({ agent: 'droid', label: 'Droid', spawnLabel: 'Droid exec' }, deps.readProcessStartTime)
  }

  protected resolveLaunch({
    identity
  }: Pick<StructuredAgentSessionAcquireInput, 'identity' | 'spawnToken'>) {
    return this.deps.resolveLaunch(identity)
  }

  protected openSession(
    input: StructuredAgentSessionAcquireInput,
    launch: DroidResolvedLaunch,
    generation: string
  ): DroidSession {
    const spec = buildDroidExecLaunch({
      command: launch.command,
      prefixArgs: launch.prefixArgs,
      cwd: launch.cwd,
      env: launch.env,
      structuredSession: { id: input.identity.sessionId, spawnToken: input.spawnToken }
    })
    // A level picked in the chat wins over Agent Permissions, as the saved Spec switch does for the mode.
    const picked = droidAutonomyLevelFromSavedOptions(input.options)
    return new DroidSession(input, generation, spec, this.deps, {
      cwd: launch.cwd,
      resumeId: launch.previous?.handle.nativeId ?? null,
      previous: launch.previous,
      autonomyLevel: picked ?? launch.autonomyLevel,
      autonomyPicked: picked !== undefined,
      interactionMode: droidInteractionModeFromSavedOptions(input.options)
    })
  }

  protected openProvider(session: DroidSession, signal: AbortSignal) {
    return session.open(signal)
  }

  protected withdrawPrompts(session: DroidSession): void {
    session.prompts.withdrawAll()
  }

  // The release refusal must stay a refusal: it is how the person learns to update.
  protected keepsRefusal = isAgentSessionPreSpawnError

  dispatch: StructuredAgentSessionAdapter['dispatch'] = async (input) => {
    const session = this.session(input.sessionId, input.fence)
    const prompt = prepareDroidPrompt(input.body)
    if (!prompt.ok) {
      return {
        state: 'rejected',
        ...agentSessionFailureWords(prompt.failure, { agentName: 'Droid', surface: 'rejection' })
      }
    }
    return session.turns.submit(
      input.clientMessageId,
      input.requestedAt ?? Date.now(),
      prompt.params,
      input.beforeDispatch
    )
  }

  dismissPrompt: NonNullable<StructuredAgentSessionAdapter['dismissPrompt']> = (input) =>
    this.session(input.sessionId, input.fence).prompts.respond(
      input.itemId,
      null,
      input.commit,
      input.answer
    )
  answerPrompt: StructuredAgentSessionAdapter['answerPrompt'] = (input) =>
    this.session(input.sessionId, input.fence).prompts.respond(
      input.itemId,
      input.response,
      input.commit
    )
  readOptions: NonNullable<StructuredAgentSessionAdapter['readOptions']> = (input) =>
    this.session(input.sessionId, input.fence).options.read()
  setOption: StructuredAgentSessionAdapter['setOption'] = async (input) => {
    const { options } = this.session(input.sessionId, input.fence)
    if (input.key === 'planMode') {
      const spec = decodeStructuredAgentSessionOptionValue('planMode', input.value)
      if (typeof spec !== 'boolean') {
        throw new AgentSessionOptionRejectedError(new Error('Spec is either on or off'))
      }
      return options.setSpec(spec)
    }
    try {
      return await options.set(input.key, input.value)
    } catch (error) {
      throw isAgentSessionOptionRejectedError(error)
        ? error
        : new AgentSessionOptionRejectedError(error)
    }
  }
}
