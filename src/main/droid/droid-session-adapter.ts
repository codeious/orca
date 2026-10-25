import { agentSessionFailureWords } from '../../shared/agent-session-failure-words'
import { decodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import { JsonlRpcSessionAdapter } from '../jsonl-rpc/session-adapter'
import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { isAgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-pre-spawn-error'
import { buildDroidExecLaunch } from './droid-exec-launch'
import { prepareDroidPrompt } from './droid-prompt'
import { DroidSession, type DroidSessionDeps } from './droid-session'
import { droidInteractionModeFromSavedOptions } from './droid-session-settings'
import { droidProviderLink, type DroidResolvedLaunch } from './droid-structured-launch-resolution'

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

  constructor(private readonly deps: DroidSessionAdapterDeps) {
    super({ agent: 'droid', label: 'Droid', spawnLabel: 'Droid exec' }, deps.readProcessStartTime)
  }

  protected resolveLaunch(identity: StructuredAgentSessionAcquireInput['identity']) {
    return this.deps.resolveLaunch(identity)
  }

  protected openSession(
    input: StructuredAgentSessionAcquireInput,
    launch: DroidResolvedLaunch,
    generation: string
  ): DroidSession {
    const spec = buildDroidExecLaunch({
      command: launch.command,
      cwd: launch.cwd,
      env: launch.env,
      structuredSession: { id: input.identity.sessionId, spawnToken: input.spawnToken }
    })
    return new DroidSession(input, generation, spec, this.deps, {
      cwd: launch.cwd,
      resumeId: launch.previous?.handle.nativeId ?? null,
      autonomyLevel: launch.autonomyLevel,
      interactionMode: droidInteractionModeFromSavedOptions(input.options)
    })
  }

  protected link = droidProviderLink

  protected startListing(session: DroidSession) {
    return session.model.startListing
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
      throw new AgentSessionOptionRejectedError(error)
    }
  }
}
