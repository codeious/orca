import { z } from 'zod'
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
import { droidPlanApprovalPresentation } from './droid-plan-approval'

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
  const first = toolUses[0]
  const details = toolUses.map((use) => use.details)
  const reason = details.find((detail) => detail?.riskLevelReason)?.riskLevelReason
  const shown = details
    .map(
      (detail, index) =>
        detail?.fullCommand ??
        detail?.patchContent ??
        formatToolInput(toolUses[index]?.toolUse.input)
    )
    .join('\n\n')
  if (plan) {
    return droidPlanApprovalPresentation(
      { ...plan.details, detail: shown, ...(reason ? { decisionReason: reason } : {}) },
      options,
      environment
    )
  }
  const bounded = boundJournalPromptBody({
    kind: 'approval',
    title: `Allow ${first?.toolUse.name ?? 'tool'}?`,
    ...(reason ? { decisionReason: reason } : {}),
    detail: truncateToolDetail(shown) || null,
    options: options.map(({ label, value }) => ({ id: value, label })),
    resolution: pendingDroidResolution
  })
  return {
    body: bounded,
    reply: (response) => {
      if (response === null) {
        return { selectedOption: REFUSAL }
      }
      if (response.kind !== 'option' || !options.some(({ value }) => value === response.optionId)) {
        throw new Error('Choose one of the options Droid offered')
      }
      return { selectedOption: response.optionId }
    }
  }
}
