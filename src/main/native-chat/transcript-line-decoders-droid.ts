// Droid session JSONL line → NativeChatMessage decoder.

import type { NativeChatMessage } from '../../shared/native-chat-types'
import { isDroidConversationMessage } from '../droid/droid-message-visibility'
import {
  asRecord,
  extractString,
  parseJsonObject,
  timestampMs
} from '../ai-vault/session-scanner-values'
import { claudeContentBlocks } from './transcript-record-blocks'

/**
 * Droid records Anthropic-style content blocks inside a `message` record. Reasoning is left out:
 * it is signed model state, and the shared block mapper would show it as the answer.
 */
export function decodeDroidTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  if (record?.type !== 'message') {
    return null
  }
  const message = asRecord(record.message)
  const role = message?.role
  if ((role !== 'user' && role !== 'assistant') || !isDroidConversationMessage(message)) {
    return null
  }
  const content = Array.isArray(message?.content)
    ? message.content.filter((block) => asRecord(block)?.type !== 'thinking')
    : message?.content
  const blocks = claudeContentBlocks(content)
  if (blocks.length === 0) {
    return null
  }
  const timestamp = timestampMs(record.timestamp)
  const parentId = extractString(record.parentId)
  return {
    id: extractString(record.id) ?? fallbackId,
    role: role === 'user' && blocks.every((block) => block.type === 'tool-result') ? 'tool' : role,
    blocks,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    source: 'transcript',
    ...(parentId ? { parentId } : {})
  }
}
