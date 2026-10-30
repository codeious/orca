import { useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { DroidComposerKey } from '../../../../shared/droid-composer-keys'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'

/**
 * What each Droid key does in a chat. A key is claimed only while its action can run, so a key the
 * chat cannot act on keeps its ordinary job (Shift+Tab moving focus back) instead of going silent.
 */
export function useNativeChatDroidComposerKeys(args: {
  agent: AgentType | undefined
  snapshot: readonly SessionOptionDescriptor[]
  surface: Pick<SessionOptionsSurface, 'setOption'> | null
}): Partial<Record<DroidComposerKey, () => void>> | undefined {
  const { agent, snapshot, surface } = args
  const spec = snapshot.find((row) => row.id === 'planMode')
  const specIsOn = spec?.kind.type === 'boolean' && spec.kind.currentValue === true
  const specCanSwitch = agent === 'droid' && spec?.kind.type === 'boolean' && spec.settable
  return useMemo(
    () =>
      specCanSwitch && surface
        ? {
            shiftTab: () => {
              void surface.setOption('planMode', !specIsOn)
            }
          }
        : undefined,
    [specCanSwitch, specIsOn, surface]
  )
}
