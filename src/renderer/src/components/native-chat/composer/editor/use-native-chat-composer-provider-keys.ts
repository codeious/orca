import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AgentType } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { ComposerKeyActions } from '../../../../../../shared/native-chat/native-chat-composer-keys'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../../../shared/native-chat/input/native-chat-session-options'
import type { NativeChatComposerInput } from './native-chat-composer-input'

export type NativeChatComposerProviderKeyArgs = {
  agent: AgentType | undefined
  snapshot: readonly SessionOptionDescriptor[]
  surface: Pick<SessionOptionsSurface, 'setOption'> | null
  isWorking: boolean
  inert: boolean
  stopTurn: (() => void) | undefined
  input: RefObject<NativeChatComposerInput | null>
  draft: string
  hasAttachments: boolean
  clear: {
    setDraft: Dispatch<SetStateAction<string>>
    setCaret: Dispatch<SetStateAction<number>>
    setActiveSuggestion: Dispatch<SetStateAction<number>>
    clearSkillOrigin: () => void
    clearImageAttachments: () => void
  }
}

type ProviderKeyHook = (args: NativeChatComposerProviderKeyArgs) => ComposerKeyActions | undefined

const PROVIDER_KEY_HOOKS: Readonly<Partial<Record<AgentType, ProviderKeyHook>>> = {}

export function useNativeChatComposerProviderKeys(
  args: NativeChatComposerProviderKeyArgs
): ComposerKeyActions | undefined {
  let keys: ComposerKeyActions | undefined
  // Every registered hook runs on every render, even when a different agent owns the composer.
  for (const [agent, providerHook] of Object.entries(PROVIDER_KEY_HOOKS)) {
    const actions = providerHook?.(args)
    if (agent === args.agent) {
      keys = actions
    }
  }
  return keys
}
