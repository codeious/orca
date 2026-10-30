import { z } from 'zod'
import type { AgentJournalQuestion } from '../../shared/agent-session-journal-types'
import {
  isValidAgentSessionQuestionAnswers,
  legacyAgentSessionQuestionAnswers
} from '../../shared/agent-session-question-answer'
import { JSON_RPC_INVALID_PARAMS } from '../acp/acp-errors'
import {
  boundJournalPromptBody,
  MAX_JOURNAL_PROMPT_OPTIONS
} from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import { pendingDroidResolution, type DroidPromptPresentation } from './droid-prompt-presentation'
import { DroidRpcError } from './droid-rpc-errors'

// Shaped after the SDK's PickOptions schema; no recording of Droid asking one exists yet.
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
  const { title, hint, emptyText, rows, multi, preselectedIds, initialSearch } = parsed.data
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
  const optionIdsByRow = new Map(options.map((option, position) => [rows[position]?.id, option.id]))
  const preselected = [
    ...new Set(
      preselectedIds.flatMap((rowId) => {
        const optionId = optionIdsByRow.get(rowId)
        return optionId === undefined ? [] : [optionId]
      })
    )
  ]
  const note = rows.length === 0 ? (emptyText ?? hint) : hint
  const question: AgentJournalQuestion = {
    id: QUESTION_ID,
    question: title,
    multiSelect: multi,
    options,
    ...(note ? { description: note } : {}),
    // A single-select holds one row, so a second preselected one would make the card unsendable.
    ...(preselected.length > 0
      ? { preselectedOptionIds: multi ? preselected : preselected.slice(0, 1) }
      : {}),
    ...(initialSearch === undefined ? {} : { initialSearch })
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
