import { decodeStructuredAgentSessionOptionValue } from '../../../../shared/agent-session/options/structured-agent-session-option-codec'

import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionOptionResult
} from '../../../../shared/agent-session/agent-session-wire'
import type { StructuredAgentSessionCaller } from '../host/structured-agent-session-host-types'
import {
  mutateStructuredAgentSession,
  type StructuredAgentSessionMutationContext
} from './structured-agent-session-mutation-context'
import { openForWrite } from './structured-agent-session-send-preparation'
import { setOptionPlan } from './structured-agent-session-mutation-plans'
import {
  noteStructuredAgentSessionOptionPick,
  recordStructuredAgentSessionOptionIntent
} from '../options/structured-agent-session-option-intent'

import { confirmIdleStructuredAgentSessionOption } from '../options/structured-agent-session-idle-option'
import { structuredPlanModePair } from '../../../../shared/agent-session/options/structured-agent-session-plan-mode-pair'

export async function setStructuredAgentSessionOption(
  context: StructuredAgentSessionMutationContext,
  caller: StructuredAgentSessionCaller,
  params: { envelope: AgentSessionMutationEnvelope; key: string; value: string }
): Promise<AgentSessionMutationResult<AgentSessionOptionResult>> {
  const plan = setOptionPlan(params)
  const noChoice =
    caller.readsOptionsWithoutModel === false && params.key === 'model' && params.value === ''
  return mutateStructuredAgentSession(
    context,
    caller,
    params.envelope,
    {
      ...plan,
      conversationWrite: true,
      run: async (ctx) => {
        const child = context.sessions.get(ctx.sessionId)?.child
        const record = context.deps.store.getRecord(ctx.sessionId)
        const pair = structuredPlanModePair(record?.provider)
        // In plan mode the main controls set the plan-mode pair the agent runs.
        const planModePick =
          !noChoice &&
          (params.key === 'model' || params.key === 'effort') &&
          record &&
          pair &&
          (child?.phase === 'ready' && !child.close
            ? (
                await context.deps.adapter.readOptions?.({
                  sessionId: ctx.sessionId,
                  fence: ctx.fence
                })
              )?.current.planMode === true
            : decodeStructuredAgentSessionOptionValue(
                'planMode',
                record.options?.planMode ?? ''
              ) === true)
        const input =
          planModePick && pair
            ? {
                key: params.key === 'model' ? pair.modelOptionId : pair.effortOptionId,
                value: params.value
              }
            : params
        const picked = await recordStructuredAgentSessionOptionIntent(context.deps, ctx, input, {
          readsWithoutModel: caller.readsOptionsWithoutModel !== false
        })
        if (picked.ok) {
          noteStructuredAgentSessionOptionPick(context, ctx, input, !noChoice)
          confirmIdleStructuredAgentSessionOption(context, ctx, input)
          return { ...picked, value: { ...picked.value, key: params.key } }
        }
        return picked
      },
      ...(noChoice
        ? {
            settledOutcome: (value: AgentSessionOptionResult) => ({
              status: 'succeeded' as const,
              sessionId: params.envelope.sessionId,
              optionResult: { version: 1, ...value }
            })
          }
        : {})
    },
    openForWrite(context, params.envelope)
  )
}
