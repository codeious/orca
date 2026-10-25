import { z } from 'zod'
import { formatToolInput, truncateToolDetail } from '../../shared/native-chat-tool-summary'
import { JSON_RPC_INVALID_PARAMS } from '../acp/acp-errors'
import { boundJournalPromptBody } from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import { pendingDroidResolution, type DroidPromptPresentation } from './droid-prompt-presentation'
import { DroidRpcError } from './droid-rpc-errors'

const detailsSchema = z.looseObject({
  fullCommand: z.string().optional(),
  patchContent: z.string().optional(),
  riskLevelReason: z.string().optional(),
  plan: z.string().optional(),
  title: z.string().optional()
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

/** A plan's other endings follow a new session id, or need an editor, neither of which Orca has. */
const unanswerableFromPlan = (value: string): boolean =>
  value.startsWith('proceed_new_session') || value === 'proceed_edit'

/** Throws a `DroidRpcError` for a request Orca cannot show, so Droid is told rather than left waiting. */
export function droidPermissionPresentation(params: unknown): DroidPromptPresentation {
  const parsed = requestSchema.safeParse(params)
  if (!parsed.success) {
    throw new DroidRpcError(JSON_RPC_INVALID_PARAMS, 'Invalid Droid permission request')
  }
  const { toolUses, options } = parsed.data
  const plan = toolUses.find((use) => use.confirmationType === PLAN_CONFIRMATION)
  const offered = options.filter(({ value }) => !(plan && unanswerableFromPlan(value)))
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
  return {
    body: boundJournalPromptBody({
      kind: 'approval',
      title: plan ? 'Review proposed plan' : `Allow ${first?.toolUse.name ?? 'tool'}?`,
      ...(plan?.details?.title ? { description: plan.details.title } : {}),
      ...(reason ? { decisionReason: reason } : {}),
      ...(text ? { subject: { kind: 'plan', text } } : {}),
      detail: truncateToolDetail(text ?? shown) || null,
      options: offered.map(({ label, value }) => ({ id: value, label })),
      resolution: pendingDroidResolution
    }),
    reply: (response) => {
      if (response === null) {
        return { selectedOption: REFUSAL }
      }
      if (response.kind !== 'option' || !offered.some(({ value }) => value === response.optionId)) {
        throw new Error('Choose one of the options Droid offered')
      }
      return { selectedOption: response.optionId }
    }
  }
}
