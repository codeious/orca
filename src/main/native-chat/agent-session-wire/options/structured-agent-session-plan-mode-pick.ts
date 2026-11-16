import { decodeStructuredAgentSessionOptionValue } from '../../../../shared/agent-session/options/selection/structured-agent-session-option-codec'
import { structuredPlanModePair } from '../../../../shared/agent-session/options/selection/structured-agent-session-plan-mode-pair'
import type { StructuredAgentSessionMutationContext } from '../operations/structured-agent-session-mutation-context'
import type { AgentSessionTurnContext } from '../operations/structured-agent-session-turns'

/** In plan mode the main model and effort controls set the plan-mode pair the agent runs, live or at rest. */
export async function structuredAgentSessionPlanModePick(
  context: StructuredAgentSessionMutationContext,
  ctx: Pick<AgentSessionTurnContext, 'sessionId' | 'fence'>,
  input: { key: string; value: string }
): Promise<{ key: string; value: string }> {
  if (input.key !== 'model' && input.key !== 'effort') {
    return input
  }
  const record = context.deps.store.getRecord(ctx.sessionId)
  const pair = structuredPlanModePair(record?.provider)
  if (!record || !pair) {
    return input
  }
  const child = context.sessions.get(ctx.sessionId)?.child
  const planMode =
    child?.phase === 'ready' && !child.close
      ? (await context.deps.adapter.readOptions?.({ sessionId: ctx.sessionId, fence: ctx.fence }))
          ?.current.planMode
      : decodeStructuredAgentSessionOptionValue('planMode', record.options?.planMode ?? '')
  return planMode === true
    ? { key: input.key === 'model' ? pair.modelOptionId : pair.effortOptionId, value: input.value }
    : input
}
