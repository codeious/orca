import type { z } from 'zod'
import {
  AgentSessionHostCommandResultSchema,
  type AgentSessionHostCommandResult
} from '../../../shared/agent-session/agent-session-host-command'
import type { HostCommandParams } from '../../../shared/rpc-contract/structured-agent-session-host-command-params'
import { refuseUnclassified } from '../../../shared/agent-session/failures/agent-session-wire-refusals'
import { admitAndRunAgentSessionMutation } from './structured-agent-session-mutation-admission'
import {
  runWithReadyStructuredAgentSessionOperation,
  openWithReadyStructuredAgentSessionChild
} from './structured-agent-session-ready-operation'
import { hostStructuredAgentSessionCurrentWork } from './structured-agent-session-host-current-work'
import { conversationCommandBlocked } from './structured-conversation-command-admission'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'

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
      admitAndRunAgentSessionMutation({
        store: context.deps.store,
        adapter: context.deps.adapter,
        agents: context.deps.agents,
        logger: context.deps.logger,
        callerKey: caller.callerKey,
        envelope,
        prepareSession: openWithReadyStructuredAgentSessionChild(context, envelope, selection),
        journal: () => context.sessions.get(sessionId)?.journal,
        currentWork: () =>
          hostStructuredAgentSessionCurrentWork(
            { store: context.deps.store, sessions: context.sessions },
            sessionId
          ),
        publish: (journal) => context.publish(sessionId, journal),
        now: context.now,
        plan: {
          ...operation,
          settledOutcome: (value) => ({ status: 'succeeded', sessionId, hostCommand: value }),
          replay: (_ctx, outcome) => {
            const parsed = AgentSessionHostCommandResultSchema.safeParse(
              outcome.status === 'succeeded' ? outcome.hostCommand : undefined
            )
            return parsed.success ? parsed.data : null
          },
          run: async (ctx) => {
            const blocked = conversationCommandBlocked(
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
        }
      })
  )
}
