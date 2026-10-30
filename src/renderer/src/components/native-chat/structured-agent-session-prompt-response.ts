import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  supportsStructuredAgentSessionApprovalNotes,
  supportsStructuredAgentSessionQuestionAnswers
} from '@/runtime/structured-agent-session-client'
import {
  legacyAgentSessionSelectedOptionId,
  type AgentSessionPromptResponse
} from '../../../../shared/agent-session-question-answer'
import type { AgentSessionPromptResult } from '../../../../shared/agent-session-wire'
import type { StructuredPromptItem } from './structured-agent-session-message-projection'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'

export async function respondToStructuredAgentSessionPrompt({
  item,
  response,
  target,
  mutate
}: {
  item: StructuredPromptItem
  response: AgentSessionPromptResponse
  target: RuntimeClientTarget
  mutate: StructuredAgentSessionMutate
}): Promise<AgentSessionPromptResult | null> {
  const promptTarget = { itemId: item.itemId, expectedRevision: item.revision }
  let fields: Record<string, unknown>
  if (response.kind === 'option') {
    const { comment, editedSpecContent } = response
    if (
      (comment !== undefined || editedSpecContent !== undefined) &&
      !(await supportsStructuredAgentSessionApprovalNotes(target))
    ) {
      // An older host refuses the strict keys, and dropping the note would answer without it.
      return null
    }
    fields = {
      ...promptTarget,
      optionId: response.optionId,
      ...(comment === undefined ? {} : { comment }),
      ...(editedSpecContent === undefined ? {} : { editedSpecContent })
    }
  } else if (await supportsStructuredAgentSessionQuestionAnswers(target)) {
    // Negotiated before mutate fingerprints the call: older hosts reject the strict field.
    fields = { ...promptTarget, answers: response.answers }
  } else {
    const optionId =
      item.body.kind === 'question'
        ? legacyAgentSessionSelectedOptionId(item.body, response.answers)
        : null
    if (optionId === null) {
      return null
    }
    fields = { ...promptTarget, optionId }
  }
  return mutate<AgentSessionPromptResult>(
    item.body.kind === 'approval'
      ? 'agentSession.respondToApproval'
      : 'agentSession.respondToQuestion',
    `agentSession.respondTo:${item.body.kind}`,
    fields
  )
}
