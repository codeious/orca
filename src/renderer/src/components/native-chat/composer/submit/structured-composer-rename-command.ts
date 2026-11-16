import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { normalizeAgentSessionConversationName } from '../../../../../../shared/agent-session/agent-session-conversation-name'
import type { StructuredAgentSessionCommandOutcome } from '../../../../../../shared/agent-session/view/structured-agent-session-composer'

/** `/rename <name>` names the chat exactly as renaming its tab does, on the host that owns it. */
export function renameStructuredChatFromComposer(
  tabId: string,
  argument: string
): Omit<StructuredAgentSessionCommandOutcome, 'handled'> {
  const name = normalizeAgentSessionConversationName(argument)
  if (!name) {
    return {
      accepted: false,
      error: translate(
        'components.native-chat.composer.renameNeedsName',
        'Use /rename followed by a chat name.'
      )
    }
  }
  useAppStore.getState().setTabCustomTitle(tabId, name)
  return { accepted: true, error: null }
}
