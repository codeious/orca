import { parseAgentJournalItemKey } from '../../shared/agent-session/journal/agent-session-journal-item-key'
import type { StructuredAgentDefinition } from '../native-chat/agent-session-wire/structured-agent-definition'

export const droidRewindMessageTarget: NonNullable<
  StructuredAgentDefinition['rewindMessageTarget']
> = (itemId, sessionId) => {
  const key = parseAgentJournalItemKey(itemId)
  return key?.provider === 'legacy' &&
    key.agent === 'droid' &&
    key.recordId.length > 0 &&
    !key.recordId.startsWith('#') &&
    !key.recordId.includes(':')
    ? { sessionId, uuid: key.recordId }
    : null
}
