import { translate } from '@/i18n/i18n'
import { isStoppedBeforeStartBlock } from '../../../../shared/native-chat-stopped-before-start'
import type { NativeChatBlock } from '../../../../shared/native-chat-types'
import { agentSessionHostText } from './agent-session-host-text'

/** Host-authored rows in this client's words, without changing how the status line is drawn. */
export function nativeChatBlocksInOwnWords(blocks: NativeChatBlock[]): NativeChatBlock[] {
  return blocks.some(
    (block) =>
      isStoppedBeforeStartBlock(block) || (block.type === 'text' && block.textKey !== undefined)
  )
    ? blocks.map((block) =>
        isStoppedBeforeStartBlock(block)
          ? {
              type: 'text',
              text: translate(
                'components.native-chat.notices.stoppedBeforeStart',
                'Stopped manually'
              )
            }
          : block.type === 'text' && block.textKey !== undefined
            ? { ...block, text: agentSessionHostText(block.text, block) }
            : block
      )
    : blocks
}
