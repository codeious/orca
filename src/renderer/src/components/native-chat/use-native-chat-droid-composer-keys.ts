import { useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { DroidComposerKey } from '../../../../shared/droid-composer-keys'
import {
  DROID_AUTONOMY_OPTION_ID,
  nextDroidAutonomyLevel
} from '../../../../shared/droid-autonomy-options'
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
  surface: Pick<SessionOptionsSurface, 'setOption' | 'autonomy'> | null
}): Partial<Record<DroidComposerKey, () => void>> | undefined {
  const { agent, snapshot, surface } = args
  const spec = snapshot.find((row) => row.id === 'planMode')
  const specIsOn = spec?.kind.type === 'boolean' && spec.kind.currentValue === true
  const specCanSwitch = agent === 'droid' && spec?.kind.type === 'boolean' && spec.settable
  const autonomy = agent === 'droid' ? surface?.autonomy : undefined
  const nextLevel = autonomy?.settable
    ? nextDroidAutonomyLevel(autonomy.levels, autonomy.level)
    : undefined
  // With one level offered there is nothing to move to, so the key keeps its ordinary job.
  const levelToPick = nextLevel !== autonomy?.level ? nextLevel : undefined
  return useMemo(() => {
    if (!surface) {
      return undefined
    }
    const keys: Partial<Record<DroidComposerKey, () => void>> = {}
    if (specCanSwitch) {
      keys.shiftTab = () => {
        void surface.setOption('planMode', !specIsOn)
      }
    }
    if (levelToPick) {
      keys.ctrlL = () => {
        void surface.setOption(DROID_AUTONOMY_OPTION_ID, levelToPick)
      }
    }
    return Object.keys(keys).length > 0 ? keys : undefined
  }, [levelToPick, specCanSwitch, specIsOn, surface])
}
