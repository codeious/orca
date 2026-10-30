import type { StructuredAgentSessionCommandOutcome } from '../../../../shared/structured-agent-session-composer'
import type {
  NativeChatSendOptions,
  NativeChatStructuredComposerTransport
} from './native-chat-composer-types'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'

export async function dispatchNativeChatStructuredComposerText(
  transport: NativeChatStructuredComposerTransport,
  text: string,
  attachments: readonly NativeChatComposerImageAttachment[] = [],
  options?: NativeChatSendOptions
): Promise<Omit<StructuredAgentSessionCommandOutcome, 'handled'> & { revealsTranscript: boolean }> {
  const { handled, ...command } = await transport.dispatchCommand(text)
  // A command's reveal, if any, came at the press; a message reveals unless it waits as a queued card.
  if (handled) {
    return { ...command, revealsTranscript: false }
  }
  const admission = options
    ? transport.send(text, attachments, options)
    : transport.send(text, attachments)
  return { accepted: admission !== false, error: null, revealsTranscript: admission === true }
}
