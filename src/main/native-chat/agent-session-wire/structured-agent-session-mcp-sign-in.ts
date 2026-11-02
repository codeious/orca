import type { AgentSessionSubscribeInput } from './agent-session-subscribe-input'
import type { AgentSessionMcpSignInForwarding } from './agent-session-mcp-sign-in-forwarding'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'
import type { AgentJournalCursor } from '../../../shared/agent-session-journal-identity'
import { emptyAgentSessionBatch } from './agent-session-empty-batch'
import type { runStructuredAgentSessionHostCommand } from './structured-agent-session-host-command'

export function bindSessionMcpSignIn(
  forwarding: AgentSessionMcpSignInForwarding,
  input: AgentSessionSubscribeInput,
  subscriber: { cursor: AgentJournalCursor; fence: number }
): (() => void) | undefined {
  return input.mcpSignInCaller
    ? forwarding.subscribe(input.id, {
        ...input.mcpSignInCaller,
        sessionId: input.sessionId,
        send: (mcpSignInOpen) =>
          input.emit({
            type: 'batch',
            sessionId: input.sessionId,
            fence: subscriber.fence,
            batch: emptyAgentSessionBatch(subscriber.cursor),
            mcpSignInOpen
          })
      })
    : undefined
}

export function bindMcpSignInHostCommand(
  forwarding: AgentSessionMcpSignInForwarding,
  run: (
    caller: StructuredAgentSessionCaller,
    params: Parameters<typeof runStructuredAgentSessionHostCommand>[2]
  ) => ReturnType<typeof runStructuredAgentSessionHostCommand>,
  localOpen?: (url: string) => boolean | Promise<boolean>
) {
  return (
    caller: StructuredAgentSessionCaller,
    params: Parameters<typeof runStructuredAgentSessionHostCommand>[2]
  ) => {
    if (params.name !== 'mcp') {
      return run(caller, params)
    }
    return forwarding.run(params.envelope.sessionId, caller.mcpSignInCaller, params.name, () =>
      run(
        {
          ...caller,
          openMcpSignIn:
            caller.localMcpSignIn && localOpen
              ? localOpen
              : (url) => forwarding.open(params.envelope.sessionId, url, params.name)
        },
        params
      )
    )
  }
}
