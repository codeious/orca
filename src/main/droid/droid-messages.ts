import type { AgentJournalToolCallItem } from '../../shared/agent-session-journal-types'
import {
  boundPayload,
  boundToolInput,
  DEFAULT_JOURNAL_PAYLOAD_LIMITS
} from '../native-chat/agent-session-journal/journal-payload-bounds'
import type {
  ProviderTimelineEvent,
  ProviderTimelineTextChannel
} from '../native-chat/agent-session-timeline/provider-timeline-event'
import type { DroidMessage, DroidNotification } from './droid-session-notifications'

const MAX_OPEN_STREAMS = 128
const MAX_OPEN_TOOLS = 128
const MAX_TOOL_BYTES = 1024 * 1024

type Arm<K extends DroidNotification['type']> = Extract<DroidNotification, { type: K }>

/** Droid names its messages, so a row is keyed by (message, content block, channel) and a snapshot
 *  of a message lands on the row its deltas already wrote. */
export class DroidMessages {
  private readonly streams = new Map<string, ProviderTimelineTextChannel>()
  private readonly closed = new Set<string>()
  private readonly tools = new Map<string, AgentJournalToolCallItem>()

  constructor(private readonly generation: string) {}

  reset(): void {
    this.streams.clear()
    this.closed.clear()
    this.tools.clear()
  }

  delta(
    notification: Arm<'assistant_text_delta' | 'thinking_text_delta'>
  ): ProviderTimelineEvent[] {
    const channel = notification.type === 'assistant_text_delta' ? 'assistant' : 'reasoning'
    const item = this.key(notification.messageId, notification.blockIndex, channel)
    if (this.streams.size >= MAX_OPEN_STREAMS && !this.streams.has(item)) {
      throw new Error('Droid message stream capacity exceeded')
    }
    this.streams.set(item, channel)
    return [{ type: 'text.delta', item: { id: item }, channel, text: notification.textDelta }]
  }

  complete(
    notification: Arm<'assistant_text_complete' | 'thinking_text_complete'>
  ): ProviderTimelineEvent[] {
    const channel = notification.type === 'assistant_text_complete' ? 'assistant' : 'reasoning'
    const item = this.key(notification.messageId, notification.blockIndex, channel)
    return this.close(item)
  }

  /** The whole message. A block nothing streamed still opens its row; one already closed is not rewritten. */
  snapshot(message: DroidMessage): ProviderTimelineEvent[] {
    const events: ProviderTimelineEvent[] = []
    message.content.forEach((block, index) => {
      const channel =
        block.type === 'text' ? 'assistant' : block.type === 'thinking' ? 'reasoning' : undefined
      const text = channel === 'assistant' ? block.text : block.thinking
      if (!channel || !text) {
        return
      }
      const item = this.key(message.id, index, channel)
      if (this.closed.has(item)) {
        return
      }
      if (!this.streams.has(item)) {
        events.push({ type: 'text.delta', item: { id: item }, channel, text })
      }
      events.push(...this.close(item, text))
    })
    return events
  }

  /** What the turn leaves open when it ends: streams Droid never completed. */
  settle(): ProviderTimelineEvent[] {
    const events = [...this.streams.keys()].flatMap((item) => this.close(item))
    this.reset()
    return events
  }

  toolCall(notification: Arm<'tool_call'>): ProviderTimelineEvent[] {
    const { id, name, input } = notification.toolUse
    const previous = this.tools.get(id)
    if (this.tools.size >= MAX_OPEN_TOOLS && !previous) {
      throw new Error('Droid tool stream capacity exceeded')
    }
    const body: AgentJournalToolCallItem = {
      kind: 'tool-call',
      name,
      callId: id,
      input: boundToolInput(input, DEFAULT_JOURNAL_PAYLOAD_LIMITS),
      state: 'running'
    }
    this.tools.set(id, body)
    if (this.toolBytes() > MAX_TOOL_BYTES) {
      throw new Error('Droid tool stream byte capacity exceeded')
    }
    return [{ type: previous ? 'item.update' : 'item.open', item: `tool:${id}`, body }]
  }

  toolResult(notification: Arm<'tool_result'>): ProviderTimelineEvent[] {
    const { toolUseId: id, content } = notification
    const previous = this.tools.get(id)
    this.tools.delete(id)
    const text = typeof content === 'string' ? content : (JSON.stringify(content) ?? '')
    const body: AgentJournalToolCallItem = {
      kind: 'tool-call',
      name: previous?.name ?? 'tool',
      callId: id,
      input: previous?.input ?? null,
      state: notification.isError ? 'failed' : 'completed',
      output: boundPayload(text, DEFAULT_JOURNAL_PAYLOAD_LIMITS)
    }
    return [{ type: 'item.close', item: `tool:${id}`, body }]
  }

  private close(item: string, text?: string): ProviderTimelineEvent[] {
    if (this.closed.has(item)) {
      return []
    }
    this.streams.delete(item)
    this.closed.add(item)
    return [{ type: 'text.close', item: { id: item }, ...(text === undefined ? {} : { text }) }]
  }

  private toolBytes(): number {
    let bytes = 0
    for (const tool of this.tools.values()) {
      bytes += Buffer.byteLength(JSON.stringify(tool))
    }
    return bytes
  }

  private key(messageId: string, index: number, channel: ProviderTimelineTextChannel): string {
    return `message:${this.generation}:${messageId}:${index}:${channel}`
  }
}
