import type { RefObject } from 'react'
import type { AgentJournalQuestion } from '../../../../shared/agent-session-journal-types'
import type { AgentSessionPromptResponse } from '../../../../shared/agent-session-question-answer'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'

export function NativeChatStructuredQuestionCard({
  questions,
  onAnswer,
  onCancel,
  cancelOnEscape,
  isSubmitting,
  shouldFocus,
  answerInputRef
}: {
  questions: readonly AgentJournalQuestion[]
  onAnswer: (response: AgentSessionPromptResponse) => void
  onCancel: () => void
  /** Escape dismisses the card; set only for an agent whose dismissal leaves its turn running. */
  cancelOnEscape?: boolean
  isSubmitting?: boolean
  shouldFocus?: boolean
  answerInputRef?: RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  return (
    <NativeChatQuestionCard
      prompt={{
        questions: questions.map((question) => {
          const preselected = (question.preselectedOptionIds ?? []).flatMap((id) => {
            const optionIndex = question.options.findIndex((option) => option.id === id)
            return optionIndex === -1 ? [] : [optionIndex]
          })
          return {
            question: question.question,
            ...(question.header ? { header: question.header } : {}),
            ...(question.description ? { description: question.description } : {}),
            multiSelect: question.multiSelect,
            options: question.options.map((option) => ({
              label: option.label,
              ...(option.description ? { description: option.description } : {})
            })),
            ...(preselected.length > 0 ? { preselected } : {}),
            ...(question.initialSearch === undefined
              ? {}
              : { initialSearch: question.initialSearch })
          }
        })
      }}
      // Escape in a typed answer is editing; dismissing there would drop the draft.
      cancelOnEscape={cancelOnEscape && !questions.some((question) => question.freeTextQuestionId)}
      allowOther={questions.map((question) => Boolean(question.freeTextQuestionId))}
      freeTextInputs={questions.map((question) => question.freeTextInput)}
      onAnswer={(answers) => {
        const chosen = questions.map((question, index) => {
          const answer = answers[index]
          const other = question.freeTextInput?.allowEmpty ? answer?.other : answer?.other?.trim()
          return {
            questionId: question.id,
            optionIds: (answer?.indices ?? []).flatMap((optionIndex) => {
              const id = question.options[optionIndex]?.id
              return id ? [id] : []
            }),
            ...(other !== undefined && (other.length > 0 || question.freeTextInput?.allowEmpty)
              ? { other }
              : {})
          }
        })
        if (chosen.every((answer) => answer.optionIds.length > 0 || answer.other !== undefined)) {
          onAnswer({ kind: 'answers', answers: chosen })
        }
      }}
      onCancel={onCancel}
      isSubmitting={isSubmitting}
      shouldFocus={shouldFocus}
      answerInputRef={answerInputRef}
    />
  )
}
