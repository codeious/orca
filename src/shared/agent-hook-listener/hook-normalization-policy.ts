import type { normalizeProviderEvent, ProviderDispatchResult } from './provider-dispatch'
import { hasExplicitUserPrompt } from './provider-event-routing'
import { hasExplicitAmpPrompt } from './providers/amp-events'
import type { AgentMainAgentStatus } from '../agent-status-types'
import type { AgentHookEventPayload } from './listener-event'

export const CLAUDE_EXIT_SESSION_END_REASONS = new Set([
  'prompt_input_exit',
  'logout',
  'other',
  'bypass_permissions_disabled'
])

export type HookNormalizationOptions = {
  deferCompactOwnershipToClient?: boolean
  previousOpenCodeMainAgent?: AgentMainAgentStatus
  bindingStatusByPaneKey?: ReadonlyMap<string, AgentHookEventPayload>
  admitOpenCodeTui?: (
    identity: Pick<
      AgentHookEventPayload,
      'paneKey' | 'launchToken' | 'hookEventName' | 'hasExplicitPrompt'
    >
  ) => boolean | 'preserve-poster'
}

export function normalizedHookHasExplicitPrompt(
  {
    source,
    sessionNormalization,
    eventName,
    promptText,
    hookPayload,
    extractedPrompt
  }: Parameters<typeof normalizeProviderEvent>[0],
  dispatched: ProviderDispatchResult
): boolean | undefined {
  return sessionNormalization?.suppressPrompt
    ? undefined
    : source === 'amp'
      ? hasExplicitAmpPrompt(eventName, promptText, hookPayload)
        ? true
        : undefined
      : hasExplicitUserPrompt(
          source,
          dispatched.eventName,
          extractedPrompt,
          dispatched.resolvedPromptText,
          dispatched.hasTranscriptPromptEvidence
        )
}
