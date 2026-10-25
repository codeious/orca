import { z } from 'zod'
import type { AgentJournalQuestion } from '../../shared/agent-session-journal-types'
import {
  isValidAgentSessionQuestionAnswers,
  legacyAgentSessionQuestionAnswers
} from '../../shared/agent-session-question-answer'
import {
  boundJournalPromptBody,
  MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS
} from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import { pendingDroidResolution, type DroidPromptPresentation } from './droid-prompt-presentation'
import { DroidRpcError } from './droid-rpc-errors'

// Shaped after the SDK's AskUser schema; no recording of Droid asking one exists yet.
const requestSchema = z.looseObject({
  questions: z
    .array(
      z.looseObject({
        index: z.number(),
        topic: z.string(),
        question: z.string(),
        options: z.array(z.string()),
        multiSelect: z.boolean().optional()
      })
    )
    .min(1)
})

/** Droid's `answer` is one string per question, so a pick of several reads as a list. */
const ANSWER_SEPARATOR = ', '

export function droidQuestionPresentation(params: unknown): DroidPromptPresentation {
  const parsed = requestSchema.safeParse(params)
  if (!parsed.success) {
    throw new DroidRpcError(-32602, 'Invalid Droid question request')
  }
  const asked = parsed.data.questions
  if (asked.length > MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS) {
    throw new DroidRpcError(
      -32602,
      `Orca shows at most ${MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS} questions at once`
    )
  }
  const questions: AgentJournalQuestion[] = asked.map((question, position) => ({
    id: `q${position + 1}`,
    question: question.question,
    header: question.topic,
    multiSelect: question.multiSelect ?? false,
    options: question.options.map((label, choice) => ({ id: `o${choice + 1}`, label })),
    freeTextQuestionId: `q${position + 1}`
  }))
  const body = boundJournalPromptBody({
    kind: 'question',
    question: questions[0]!.question,
    options: questions[0]!.options,
    questions,
    resolution: pendingDroidResolution
  })
  return {
    body,
    reply: (response) => {
      if (response === null) {
        return { cancelled: true, answers: [] }
      }
      const answers =
        response.kind === 'answers'
          ? response.answers
          : legacyAgentSessionQuestionAnswers(body, response.optionId)
      if (!answers || !isValidAgentSessionQuestionAnswers(questions, answers)) {
        throw new Error('Answer every question Droid asked')
      }
      return {
        answers: questions.map((question, position) => {
          const given = answers.find((answer) => answer.questionId === question.id)
          const parts = (given?.optionIds ?? []).map(
            (id) => question.options.find((option) => option.id === id)?.label ?? id
          )
          const typed = given?.other?.trim()
          if (typed) {
            parts.push(typed)
          }
          return {
            index: asked[position]!.index,
            question: question.question,
            answer: parts.join(ANSWER_SEPARATOR)
          }
        })
      }
    }
  }
}
