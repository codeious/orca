import { z } from 'zod'
import type { AgentJournalQuestion } from '../../shared/agent-session-journal-types'
import {
  isValidAgentSessionQuestionAnswers,
  legacyAgentSessionQuestionAnswers,
  type AgentSessionPromptResponse
} from '../../shared/agent-session-question-answer'
import { JSON_RPC_INVALID_PARAMS } from '../acp/acp-errors'
import {
  boundJournalPromptBody,
  MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS
} from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import { pendingDroidResolution, type DroidPromptPresentation } from './droid-prompt-presentation'
import { DroidRpcError } from './droid-rpc-errors'

// Shaped after the SDK's AskUser schema and the multiSelect request Droid 0.251.0 sent.
const requestSchema = z.looseObject({
  questions: z
    .array(
      // Strips workstreamProposal: it has no card here, and the plain question is answerable without it.
      z.object({
        index: z.number(),
        topic: z.string(),
        question: z.string(),
        options: z.array(z.string()),
        multiSelect: z.boolean().optional()
      })
    )
    .min(1)
})

type AskedQuestion = z.infer<typeof requestSchema>['questions'][number]
type CollectedAnswer = { index: number; question: string; answer: string }

/** Droid's `answer` is one string per question, so a pick of several reads as a list. */
const ANSWER_SEPARATOR = ', '

export function droidQuestionPresentation(params: unknown): DroidPromptPresentation {
  const parsed = requestSchema.safeParse(params)
  if (!parsed.success) {
    throw new DroidRpcError(JSON_RPC_INVALID_PARAMS, 'Invalid Droid question request')
  }
  return questionCard(parsed.data.questions, 0, [])
}

/** A card holds at most the shared grouped-question cap, so a longer request is asked a card at a
 *  time and Droid hears one answer once the last card is answered. */
function questionCard(
  asked: readonly AskedQuestion[],
  offset: number,
  answeredBefore: readonly CollectedAnswer[]
): DroidPromptPresentation {
  const shown = asked.slice(offset, offset + MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS)
  const questions: AgentJournalQuestion[] = shown.map((question, position) => {
    const id = `q${offset + position + 1}`
    return {
      id,
      question: question.question,
      header: question.topic,
      multiSelect: question.multiSelect ?? false,
      options: question.options.map((label, choice) => ({ id: `o${choice + 1}`, label })),
      freeTextQuestionId: id
    }
  })
  const body = boundJournalPromptBody({
    kind: 'question',
    question: questions[0]!.question,
    options: questions[0]!.options,
    questions,
    resolution: pendingDroidResolution
  })
  const collect = (response: AgentSessionPromptResponse): CollectedAnswer[] => {
    const answers =
      response.kind === 'answers'
        ? response.answers
        : legacyAgentSessionQuestionAnswers(body, response.optionId)
    if (!answers || !isValidAgentSessionQuestionAnswers(questions, answers)) {
      throw new Error('Answer every question Droid asked')
    }
    return [
      ...answeredBefore,
      ...questions.map((question, position) => {
        const given = answers.find((answer) => answer.questionId === question.id)
        const parts = (given?.optionIds ?? []).map(
          (id) => question.options.find((option) => option.id === id)?.label ?? id
        )
        const typed = given?.other?.trim()
        if (typed) {
          parts.push(typed)
        }
        return {
          index: shown[position]!.index,
          question: question.question,
          answer: parts.join(ANSWER_SEPARATOR)
        }
      })
    ]
  }
  const next = offset + MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS
  return {
    body,
    reply: (response) =>
      response === null ? { cancelled: true, answers: [] } : { answers: collect(response) },
    ...(next < asked.length
      ? { advance: (response) => questionCard(asked, next, collect(response)) }
      : {})
  }
}
