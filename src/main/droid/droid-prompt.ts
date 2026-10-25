import {
  agentSessionFailureFact,
  type SubmissionRejectionFact
} from '../../shared/agent-session-failure'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import { DROID_PEER_LIMITS } from './droid-peer-limits'

/** The most text one send carries: a frame is one line, and the stamp and envelope share it. */
export const DROID_PROMPT_MAX_BYTES = DROID_PEER_LIMITS.maxLineBytes - 64 * 1024

export type DroidPrompt =
  | { ok: true; params: { text: string } }
  | { ok: false; failure: SubmissionRejectionFact }

/** Text only: an image is refused rather than dropped, since the person would not know it was lost. */
export function prepareDroidPrompt(body: AgentJournalMessageItem): DroidPrompt {
  if (body.role !== 'user') {
    return { ok: false, failure: agentSessionFailureFact('emptyMessage') }
  }
  const texts: string[] = []
  for (const block of body.blocks) {
    if (block.type === 'image-ref') {
      return {
        ok: false,
        failure: agentSessionFailureFact('attachmentInvalid', {
          attachment: { reason: 'unsupportedType' }
        })
      }
    }
    if (block.type === 'text' && block.text.length > 0) {
      texts.push(block.text)
    }
  }
  if (texts.length === 0) {
    return { ok: false, failure: agentSessionFailureFact('emptyMessage') }
  }
  const text = texts.join('\n')
  if (Buffer.byteLength(text, 'utf8') > DROID_PROMPT_MAX_BYTES) {
    return { ok: false, failure: agentSessionFailureFact('historyTooLarge') }
  }
  return { ok: true, params: { text } }
}
