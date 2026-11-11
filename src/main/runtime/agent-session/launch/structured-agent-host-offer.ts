import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { structuredAgentRuntimeMetadata } from '../installation/structured-agent-runtime-metadata'

export type StructuredAgentHostOfferRuntime = {
  requireStore(): { getSettings(): Pick<GlobalSettings, 'experimentalChatAgents'> }
}

/** New chats of an experimental agent wait for this host's opt-in; a host whose settings cannot be read offers none. */
export function hostOffersStructuredAgent(
  runtime: StructuredAgentHostOfferRuntime,
  agent: string
): boolean {
  if (!structuredAgentRuntimeMetadata(agent)?.definition.experimental) {
    return true
  }
  try {
    return runtime.requireStore().getSettings().experimentalChatAgents === true
  } catch {
    return false
  }
}
