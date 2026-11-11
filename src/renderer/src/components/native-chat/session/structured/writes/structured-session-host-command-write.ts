import type { AgentSessionHostCommandResult } from '../../../../../../../shared/agent-session/agent-session-host-command'
import { AGENT_SESSION_HOST_COMMAND_CAPABILITY } from '../../../../../../../shared/agent-session/agent-session-host-command'
import { structuredAgentSessionHostSupports } from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-support'
import { structuredComposerFailure } from '../../../../../../../shared/agent-session/failures/structured-agent-session-composer-failure'
import type { RuntimeClientTarget } from '../../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { StructuredAgentSessionWrite } from './use-structured-agent-session-mutate'
import type { StructuredAgentSessionComposerOptions } from '../../../../../../../shared/agent-session/view/structured-agent-session-composer'

export function structuredSessionHostCommandRunner(
  write: StructuredAgentSessionWrite,
  target: RuntimeClientTarget
): NonNullable<StructuredAgentSessionComposerOptions['runHostCommand']> {
  return async (name, argument) => {
    if (
      !(await structuredAgentSessionHostSupports(target, AGENT_SESSION_HOST_COMMAND_CAPABILITY))
    ) {
      return {
        accepted: false,
        ...structuredComposerFailure('commandUnsupportedByHost', { name })
      }
    }
    const outcome = await write<AgentSessionHostCommandResult>(
      'agentSession.hostCommand',
      'agentSession.hostCommand',
      { name, argument }
    )
    return {
      accepted: outcome.kind === 'done',
      error: outcome.kind === 'not-done' ? outcome.notice : null
    }
  }
}
