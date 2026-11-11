import type { RefObject } from 'react'
import { agentSessionPromptQuestions } from '../../../../../shared/agent-session/agent-session-question-answer'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { useStructuredChatApproval } from './use-structured-chat-approval'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import { NativeChatStructuredQuestionCard } from './NativeChatStructuredQuestionCard'
import type { useStructuredPromptResponseHold } from './use-structured-prompt-response-hold'

type PromptResponse = ReturnType<typeof useStructuredPromptResponseHold>
type PromptItem = Parameters<PromptResponse['holds']>[0]

/** The chat's own open prompt in the slot above the message box: an approval or a question card. */
export function NativeChatStructuredPromptCard({
  prompt,
  target,
  promptResponse,
  onCancel,
  shouldFocus,
  answerInputRef
}: {
  prompt: PromptItem | null
  target: RuntimeClientTarget
  promptResponse: PromptResponse
  onCancel: () => void
  shouldFocus: boolean
  answerInputRef: RefObject<HTMLTextAreaElement | null>
}): React.JSX.Element | null {
  const approval = useStructuredChatApproval(prompt?.body, target)
  if (prompt && approval) {
    return (
      <NativeChatApprovalCard
        approval={approval}
        onChoose={(optionId) => void promptResponse.respond(prompt, { kind: 'option', optionId })}
        isSubmitting={promptResponse.holds(prompt)}
        onCancel={onCancel}
        shouldFocus={shouldFocus}
      />
    )
  }
  if (prompt?.body.kind === 'question') {
    return (
      <NativeChatStructuredQuestionCard
        questions={agentSessionPromptQuestions(prompt.body)}
        onAnswer={(response) => void promptResponse.respond(prompt, response)}
        isSubmitting={promptResponse.holds(prompt)}
        onCancel={onCancel}
        shouldFocus={shouldFocus}
        answerInputRef={answerInputRef}
      />
    )
  }
  return null
}
