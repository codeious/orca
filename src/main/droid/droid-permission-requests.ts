import { z } from 'zod'
import { isPlanApprovalSubject } from '../../shared/agent-session-approval-subject'
import { formatToolInput, truncateToolDetail } from '../../shared/native-chat-tool-summary'
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
const unanswerableFromPlan = (value: string, handoff: boolean): boolean =>
  value === 'proceed_edit' || (startsDroidSpecHandoff(value) && !handoff)

/** A person's note, or the plan as they edited it, goes to Droid only when it holds something. */
const typed = (text: string | undefined): string | undefined =>
  text !== undefined && text.trim() !== '' ? text : undefined

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
  // A Droid that names this flag also takes a comment and an edited plan in the result.
  const handoff = plan?.details?.supportsClientStartedHandoff === true
  const reported = environment.autonomyLevels()
  const offered = options.filter(({ value }) => {
    if (!plan) {
      return true
    }
    const level = droidPlanOptionLevel(value)
    return (
      !unanswerableFromPlan(value, handoff) &&
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
  // An editor started from a plan the journal clipped would send the clip's marker back as the plan.
  const planKept = isPlanApprovalSubject(bounded.subject) && bounded.subject.text === text
  return {
    body:
      plan && handoff
        ? { ...bounded, acceptsComment: true, ...(planKept ? { acceptsPlanEdit: true } : {}) }
        : bounded,
    reply: (response) => {
      if (response === null) {
        return { selectedOption: REFUSAL }
      }
      if (response.kind !== 'option' || !offered.some(({ value }) => value === response.optionId)) {
        throw new Error('Choose one of the options Droid offered')
      }
      const selectedOption = response.optionId
      if (!plan || !handoff) {
        return { selectedOption }
      }
      const comment = typed(response.comment)
      const editedSpecContent = typed(response.editedSpecContent)
      return {
        selectedOption,
        ...(startsDroidSpecHandoff(selectedOption)
          ? {
              clientStartsHandoffSession: true,
              specHandoffId: environment.handoffs.begin(selectedOption)
            }
          : {}),
        ...(comment === undefined ? {} : { comment }),
        ...(editedSpecContent === undefined ? {} : { editedSpecContent })
      }
    }
  }
}
