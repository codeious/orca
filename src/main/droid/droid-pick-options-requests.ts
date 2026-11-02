import { z } from 'zod'
import type { AgentJournalQuestion } from '../../shared/agent-session/journal/agent-session-journal-types'
import {
  isValidAgentSessionQuestionAnswers,
  legacyAgentSessionQuestionAnswers
} from '../../shared/agent-session/agent-session-question-answer'
import { JSON_RPC_INVALID_PARAMS } from '../acp/acp-errors'
import {
  boundJournalPromptBody,
  MAX_JOURNAL_PROMPT_OPTIONS
} from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import { pendingDroidResolution, type DroidPromptPresentation } from './droid-prompt-presentation'
import { DroidRpcError } from './droid-rpc-errors'

// Published stream-jsonrpc contract; covered by synthetic requests, not a captured picker.
const requestSchema = z.looseObject({
  toolCallId: z.string(),
  title: z.string(),
  hint: z.string().optional(),
  emptyText: z.string().optional(),
  rows: z.array(
    z.looseObject({ id: z.string(), label: z.string(), detail: z.string().optional() })
  ),
  multi: z.boolean(),
  preselectedIds: z.array(z.string()),
  initialSearch: z.string().optional()
})

const QUESTION_ID = 'q1'

export function droidPickOptionsPresentation(params: unknown): DroidPromptPresentation {
  const parsed = requestSchema.safeParse(params)
  if (!parsed.success) {
    throw new DroidRpcError(JSON_RPC_INVALID_PARAMS, 'Invalid Droid pick-options request')
  }
  const { title, hint, emptyText, rows, multi } = parsed.data
  if (rows.length > MAX_JOURNAL_PROMPT_OPTIONS) {
    throw new DroidRpcError(
      JSON_RPC_INVALID_PARAMS,
      `Orca shows at most ${MAX_JOURNAL_PROMPT_OPTIONS} rows at once`
    )
  }
  // Droid's row ids are its own and unbounded; the card numbers its options and the reply maps back.
  const options = rows.map((row, position) => ({
    id: `o${position + 1}`,
    label: row.label,
    ...(row.detail ? { description: row.detail } : {})
  }))
  const rowIds = new Map(options.map((option, position) => [option.id, rows[position]?.id]))
  const note = rows.length === 0 ? (emptyText ?? hint) : hint
  const question: AgentJournalQuestion = {
    id: QUESTION_ID,
    question: note ? `${title}\n\n${note}` : title,
    multiSelect: multi,
    options
  }
  const body = boundJournalPromptBody({
    kind: 'question',
    question: question.question,
    options,
    questions: [question],
    resolution: pendingDroidResolution
  })
  return {
    body,
    reply: (response) => {
      // A dismissal is a cancel, not an error: Droid tells "no picker" from "the person said no".
      if (response === null) {
        return { cancelled: true, selectedIds: [] }
      }
      const answers =
        response.kind === 'answers'
          ? response.answers
          : legacyAgentSessionQuestionAnswers(body, response.optionId)
      if (!answers || !isValidAgentSessionQuestionAnswers([question], answers)) {
        throw new Error('Choose from the rows Droid offered')
      }
      return {
        selectedIds: (answers[0]?.optionIds ?? []).flatMap((id) => {
          const rowId = rowIds.get(id)
          return rowId === undefined ? [] : [rowId]
        })
      }
    }
  }
}
