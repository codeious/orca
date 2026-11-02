import { useStructuredAgentSessionHostCapabilityState } from '@/runtime/structured-agent-session-host-capability'
import { AGENT_SESSION_APPROVAL_NOTES_CAPABILITY } from '../../../../shared/agent-session/structured-agent-session-surface-capabilities'
import type { StructuredPromptItem } from '../../../../shared/agent-session/view/structured-agent-session-message-projection'
import {
  chatApprovalFromJournal,
  type ChatApproval
} from '../../../../shared/native-chat/input/native-chat-interactive-prompt'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export function useStructuredChatApproval(
  body: StructuredPromptItem['body'] | undefined,
  target: RuntimeClientTarget
): ChatApproval | null {
  const takesNotes =
    useStructuredAgentSessionHostCapabilityState(
      target,
      AGENT_SESSION_APPROVAL_NOTES_CAPABILITY
    ) === 'supported'
  if (body?.kind !== 'approval') {
    return null
  }
  const { acceptsComment, acceptsPlanEdit, ...approval } = chatApprovalFromJournal(body)
  return {
    ...approval,
    ...(takesNotes && acceptsComment ? { acceptsComment: true } : {}),
    ...(takesNotes && acceptsPlanEdit ? { acceptsPlanEdit: true } : {})
  }
}
