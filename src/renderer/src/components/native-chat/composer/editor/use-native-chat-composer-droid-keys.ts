import { useContext } from 'react'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { NativeChatRewindContext } from '../../messages/actions/native-chat-rewind-context'
import {
  DROID_COMPOSER_KEYS,
  type DroidComposerKey
} from '../../../../../../shared/droid-composer-keys'
import { DROID_AUTONOMY_OPTION_ID } from '../../../../../../shared/droid-autonomy-options'
import { getNativeChatComposerKeyClaims } from '../../../../../../shared/native-chat/native-chat-agent-profiles'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'
import type { SessionOptionDescriptor } from '../../../../../../shared/native-chat/input/native-chat-session-options'
import { nativeChatComposerSelectedText } from './native-chat-composer-input'
import { useNativeChatDroidTurnKeys } from './use-native-chat-droid-turn-keys'
import type { NativeChatComposerProviderKeyArgs } from './use-native-chat-composer-provider-keys'

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

function droidModeKeyActions({
  agent,
  snapshot,
  surface,
  isWorking,
  sendAfterReply
}: NativeChatComposerProviderKeyArgs): Partial<Record<DroidComposerKey, () => void>> | undefined {
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
      keys[key] = () => {}
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

export function useNativeChatComposerDroidKeys(args: NativeChatComposerProviderKeyArgs) {
  const modeKeys = droidModeKeyActions(args)
  const keys =
    args.inert && modeKeys
      ? Object.fromEntries(DROID_COMPOSER_KEYS.map((key) => [key, () => {}]))
      : modeKeys
  const rewind = useContext(NativeChatRewindContext)
  const confirm = useContext(ConfirmationDialogContext)
  const latest = rewind?.eligibleItemIds ? [...rewind.eligibleItemIds].at(-1) : undefined
  const requestRewind =
    rewind && !rewind.disabledReason && confirm && latest
      ? () => {
          void rewind.request(latest, confirm)
        }
      : undefined
  return useNativeChatDroidTurnKeys({
    agent: args.agent,
    keys,
    inert: args.inert,
    stopTurn: args.stopTurn,
    openRewind: requestRewind,
    selectedText: () => nativeChatComposerSelectedText(args.input.current),
    hasContent: args.draft !== '' || args.hasAttachments,
    clearComposer: () => {
      args.clear.setDraft('')
      args.clear.setCaret(0)
      args.clear.setActiveSuggestion(0)
      args.clear.clearSkillOrigin()
      args.clear.clearImageAttachments()
    }
  })
}
