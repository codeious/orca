import type { z } from 'zod'
import {
  AgentSessionHostCommandResultSchema,
  type AgentSessionHostCommandResult
} from '../../../../shared/agent-session/agent-session-host-command'
import type { HostCommandParams } from '../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-host-command-params'
import { refuseUnclassified } from '../../../../shared/agent-session/failures/agent-session-wire-refusals'
import { runWithReadyStructuredAgentSessionOperation } from './structured-agent-session-ready-operation'
import { openWithReadyStructuredAgentSessionChild } from './structured-agent-session-operation-child'
import { conversationCommandBlocked } from './structured-conversation-command-admission'
import {
  runStructuredAgentSessionMutation,
  type StructuredAgentSessionMutationContext
} from './structured-agent-session-mutation-context'
import type { StructuredAgentSessionCaller } from '../host/structured-agent-session-host-types'

export function runStructuredAgentSessionHostCommand(
  context: StructuredAgentSessionMutationContext,
  caller: StructuredAgentSessionCaller,
  params: z.infer<typeof HostCommandParams>
) {
  const { envelope, name, argument } = params
  const { sessionId } = envelope
  const operation = { method: 'agentSession.hostCommand', fields: { name, argument } }
  return runWithReadyStructuredAgentSessionOperation<AgentSessionHostCommandResult>(
    context,
    caller.callerKey,
    envelope,
    operation,
    (selection) =>
      runStructuredAgentSessionMutation(
        context,
        caller,
        envelope,
        {
          ...operation,
          settledOutcome: (value) => ({ status: 'succeeded', sessionId, hostCommand: value }),
          replay: (_ctx, outcome) => {
            const parsed = AgentSessionHostCommandResultSchema.safeParse(
              outcome.status === 'succeeded' ? outcome.hostCommand : undefined
            )
            return parsed.success ? parsed.data : null
          },
          run: async (ctx) => {
            const blocked = await conversationCommandBlocked(
              ctx,
              context.deps.store.requireWritableRecord(sessionId),
              { views: context.readChildWork(sessionId), open: context.childWorkOpen(sessionId) }
            )
            if (blocked) {
              return { ok: false, refusal: blocked }
            }
            if (
              !ctx.adapter.hostCommand ||
              !ctx.adapter
                .readCommands?.(sessionId)
                ?.some((entry) => entry.hostCommand && entry.name === name)
            ) {
              return {
                ok: false,
                refusal: refuseUnclassified(
                  'agent_session_operation_invalid',
                  'This command is unavailable in this chat.'
                )
              }
            }
            const value = AgentSessionHostCommandResultSchema.parse(
              await ctx.adapter.hostCommand({
                sessionId,
                fence: ctx.fence,
                name,
                argument,
                operationId: envelope.clientOperationId
              })
            )
            return { ok: true, value }
          }
        },
        openWithReadyStructuredAgentSessionChild(context, envelope, selection)
      )
  )
}
