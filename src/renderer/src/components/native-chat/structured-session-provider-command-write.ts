import type { AgentSessionHostCommandResult } from '../../../../shared/agent-session/agent-session-host-command'
import { AGENT_SESSION_HOST_COMMAND_CAPABILITY } from '../../../../shared/agent-session/agent-session-host-command'
import { structuredAgentSessionHostSupports } from '@/runtime/structured-agent-session-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { StructuredAgentSessionWrite } from './use-structured-agent-session-mutate'
import type { StructuredAgentSessionComposerOptions } from '../../../../shared/agent-session/view/structured-agent-session-composer'

export function structuredSessionProviderCommands(
  write: StructuredAgentSessionWrite,
  target: RuntimeClientTarget
) {
  const runHostCommand: NonNullable<
    StructuredAgentSessionComposerOptions['runHostCommand']
  > = async (name, argument) => {
    if (
      !(await structuredAgentSessionHostSupports(target, AGENT_SESSION_HOST_COMMAND_CAPABILITY))
    ) {
      return {
        accepted: false,
        error: 'This host does not support chat commands. Update Orca on the host.'
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
  return {
    runHostCommand,
    copyConversation: () =>
      write<{ providerSessionId: string }>(
        'agentSession.copyConversation',
        'agentSession.copyConversation',
        {}
      )
  }
}
