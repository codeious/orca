import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session/agent-session-wire'
import { refuseUnclassified } from '../../../shared/agent-session/failures/agent-session-wire-refusals'
import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { admitAndRunAgentSessionMutation } from './structured-agent-session-mutation-admission'
import {
  runWithReadyStructuredAgentSessionOperation,
  openWithReadyStructuredAgentSessionChild
} from './structured-agent-session-ready-operation'
import { hostStructuredAgentSessionCurrentWork } from './structured-agent-session-host-current-work'
import { conversationCommandBlocked } from './structured-conversation-command-admission'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'

export function copyStructuredAgentSessionConversation(
  context: StructuredAgentSessionMutationContext,
  caller: StructuredAgentSessionCaller,
  envelope: AgentSessionMutationEnvelope
) {
  const { sessionId } = envelope
  const { store } = context.deps
  const operation = { method: 'agentSession.copyConversation', fields: {} }
  return runWithReadyStructuredAgentSessionOperation<{ providerSessionId: string }>(
    context,
    caller.callerKey,
    envelope,
    operation,
    (selection) =>
      admitAndRunAgentSessionMutation({
        store,
        adapter: context.deps.adapter,
        agents: context.deps.agents,
        logger: context.deps.logger,
        callerKey: caller.callerKey,
        envelope,
        prepareSession: openWithReadyStructuredAgentSessionChild(context, envelope, selection),
        journal: () => context.sessions.get(sessionId)?.journal,
        currentWork: () =>
          hostStructuredAgentSessionCurrentWork({ store, sessions: context.sessions }, sessionId),
        publish: (journal) => context.publish(sessionId, journal),
        now: context.now,
        plan: {
          ...operation,
          settledOutcome: (conversationCopy) => ({
            status: 'succeeded',
            sessionId,
            conversationCopy
          }),
          replay: (_ctx, outcome) =>
            outcome.status === 'succeeded' ? (outcome.conversationCopy ?? null) : null,
          run: async (ctx) => {
            const record = store.requireWritableRecord(sessionId)
            const blocked = conversationCommandBlocked(ctx, record, {
              views: context.readChildWork(sessionId),
              open: context.childWorkOpen(sessionId)
            })
            if (blocked) {
              return { ok: false, refusal: blocked }
            }
            const head = agentSessionProviderHandleChainHead(record.providerHandleChain)?.handle
            if (!head || !ctx.adapter.copyConversation) {
              return {
                ok: false,
                refusal: refuseUnclassified(
                  'agent_session_operation_invalid',
                  'This chat cannot be forked.'
                )
              }
            }
            const copy = await ctx.adapter.copyConversation({
              identity: {
                sessionId,
                workspaceId: record.location.workspaceId,
                hostId: record.location.executionHostId,
                agent: record.provider,
                providerHandle: head
              },
              providerSessionId: head.nativeId,
              accountHome: record.accountHome
            })
            if (!copy.sessionId.trim() || copy.sessionId === head.nativeId) {
              throw new Error('The agent did not confirm a new conversation copy.')
            }
            return { ok: true, value: { providerSessionId: copy.sessionId } }
          }
        }
      })
  )
}
