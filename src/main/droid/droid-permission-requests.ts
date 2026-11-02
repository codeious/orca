import { z } from 'zod'
import { isPlanApprovalSubject } from '../../shared/agent-session/agent-session-approval-subject'
import {
  formatToolInput,
  truncateToolDetail
} from '../../shared/native-chat/tools/native-chat-tool-summary'
import { JSON_RPC_INVALID_PARAMS } from '../acp/acp-errors'
import { boundJournalPromptBody } from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import {
  pendingDroidResolution,
  type DroidPromptEnvironment,
  type DroidPromptPresentation
} from './droid-prompt-presentation'
import { DroidRpcError } from './droid-rpc-errors'
import { droidPlanOptionLevel, startsDroidSpecHandoff } from './droid-spec-handoff'

const detailsSchema = z.looseObject({
  fullCommand: z.string().optional(),
  patchContent: z.string().optional(),
  riskLevelReason: z.string().optional(),
  plan: z.string().optional(),
  title: z.string().optional(),
  supportsClientStartedHandoff: z.boolean().optional()
})
const requestSchema = z.looseObject({
  toolUses: z
    .array(
      z.looseObject({
        toolUse: z.looseObject({ name: z.string(), input: z.unknown() }),
        confirmationType: z.string().optional(),
        details: detailsSchema.optional()
      })
    )
    .min(1),
  options: z.array(z.looseObject({ label: z.string(), value: z.string() }))
})

const PLAN_CONFIRMATION = 'exit_spec_mode'
const REFUSAL = 'cancel'

/** A plan's ending Orca cannot follow: `proceed_edit` needs an editor of Droid's, and a new session is
 *  the client's to start only when the request says so. */
/** Throws a `DroidRpcError` for a request Orca cannot show, so Droid is told rather than left waiting. */
export function droidPermissionPresentation(
  params: unknown,
  environment: DroidPromptEnvironment
): DroidPromptPresentation {
  const parsed = requestSchema.safeParse(params)
  if (!parsed.success) {
    throw new DroidRpcError(JSON_RPC_INVALID_PARAMS, 'Invalid Droid permission request')
  }
  const { toolUses, options } = parsed.data
  const plan = toolUses.find((use) => use.confirmationType === PLAN_CONFIRMATION)
  const takesNotes = plan?.details?.supportsClientStartedHandoff === true
  const handsOff = takesNotes && environment.beginSpecHandoff !== undefined
  const reported = environment.autonomyLevels()
  const offered = options.filter(({ value }) => {
    if (!plan) {
      return true
    }
    const level = droidPlanOptionLevel(value)
    return (
      value !== 'proceed_edit' &&
      (handsOff || !startsDroidSpecHandoff(value)) &&
      (level === null || reported === undefined || reported.includes(level))
    )
  })
  const first = toolUses[0]
  const details = toolUses.map((use) => use.details)
  const text = plan?.details?.plan
  const reason = details.find((detail) => detail?.riskLevelReason)?.riskLevelReason
  const shown = details
    .map(
      (detail, index) =>
        detail?.fullCommand ??
        detail?.patchContent ??
        formatToolInput(toolUses[index]?.toolUse.input)
    )
    .join('\n\n')
  const bounded = boundJournalPromptBody({
    kind: 'approval',
    title: plan ? 'Review proposed plan' : `Allow ${first?.toolUse.name ?? 'tool'}?`,
    ...(plan?.details?.title ? { description: plan.details.title } : {}),
    ...(reason ? { decisionReason: reason } : {}),
    ...(text ? { subject: { kind: 'plan', text } } : {}),
    detail: truncateToolDetail(text ?? shown) || null,
    options: offered.map(({ label, value }) => ({ id: value, label })),
    resolution: pendingDroidResolution
  })
  return {
    body: takesNotes
      ? {
          ...bounded,
          acceptsComment: true,
          ...(isPlanApprovalSubject(bounded.subject) && bounded.subject.text === text
            ? { acceptsPlanEdit: true }
            : {})
        }
      : bounded,
    reply: (response, operationId) => {
      if (response === null) {
        return { selectedOption: REFUSAL }
      }
      if (response.kind !== 'option' || !offered.some(({ value }) => value === response.optionId)) {
        throw new Error('Choose one of the options Droid offered')
      }
      const handoff = handsOff && startsDroidSpecHandoff(response.optionId)
      if (handoff && !operationId) {
        throw new Error('A plan handoff requires a host operation ID')
      }
      return {
        selectedOption: response.optionId,
        ...(handoff && operationId
          ? {
              clientStartsHandoffSession: true,
              specHandoffId: environment.beginSpecHandoff?.(response.optionId, operationId)
            }
          : {}),
        ...(takesNotes && response.comment?.trim() ? { comment: response.comment } : {}),
        ...(takesNotes && response.editedSpecContent?.trim()
          ? { editedSpecContent: response.editedSpecContent }
          : {})
      }
    }
  }
}
