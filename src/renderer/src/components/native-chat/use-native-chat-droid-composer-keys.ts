import type { AgentType } from '../../../../shared/agent-status-types'
import type { DroidComposerKey } from '../../../../shared/droid-composer-keys'
import { DROID_AUTONOMY_OPTION_ID } from '../../../../shared/droid-autonomy-options'
import { getNativeChatComposerKeyClaims } from '../../../../shared/native-chat/native-chat-agent-profiles'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat/input/native-chat-session-options'

function holdKey(): void {}

function nextChoiceValue(row: SessionOptionDescriptor | undefined): string | undefined {
  if (!row || row.kind.type !== 'select' || !row.settable) {
    return undefined
  }
  const { choices, currentValue } = row.kind
  const from = choices.findIndex((choice) => choice.value === currentValue) + 1
  return choices
    .slice(from)
    .concat(choices.slice(0, from))
    .find((choice) => choice.value !== currentValue)?.value
}

/** Use the same offered values and write path as the option selectors. */
export function useNativeChatDroidComposerKeys(args: {
  agent: AgentType | undefined
  snapshot: readonly SessionOptionDescriptor[]
  surface: Pick<SessionOptionsSurface, 'setOption'> | null
  isWorking?: boolean | undefined
  sendAfterReply?: (() => void) | undefined
}): Partial<Record<DroidComposerKey, () => void>> | undefined {
  const { agent, snapshot, surface, isWorking = false, sendAfterReply } = args
  const claims = getNativeChatComposerKeyClaims(agent, getShortcutPlatform())
  const keys: Partial<Record<DroidComposerKey, () => void>> = {}
  if (sendAfterReply && claims.includes('ctrlEnter')) {
    keys.ctrlEnter = sendAfterReply
  }
  const options = [
    ['shiftTab', 'planMode'],
    ['ctrlL', DROID_AUTONOMY_OPTION_ID],
    ['tab', 'effort'],
    ['ctrlN', 'model']
  ] as const
  for (const [key, id] of options) {
    if (!claims.includes(key)) {
      continue
    }
    if (isWorking) {
      keys[key] = holdKey
      continue
    }
    const row = snapshot.find((row) => row.id === id)
    const value =
      row?.kind.type === 'boolean' && row.settable ? !row.kind.currentValue : nextChoiceValue(row)
    if (surface && value !== undefined) {
      keys[key] = () => {
        void surface.setOption(id, value)
      }
    }
  }
  return Object.keys(keys).length > 0 ? keys : undefined
}
