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

function holdKey(): void {}

// Claimed and idle while a turn runs, so the key neither acts nor falls through to move focus or type.
const HELD_KEYS: Partial<Record<DroidComposerKey, () => void>> = {
  shiftTab: holdKey,
  ctrlL: holdKey,
  tab: holdKey,
  ctrlN: holdKey
}

/** The choice after the current one, in the row's own order, wrapping. A value the row does not
 *  name (a cold chat, an effort nobody reported) starts at the first choice. */
function nextChoiceValue(row: SessionOptionDescriptor | undefined): string | undefined {
  if (!row || row.kind.type !== 'select' || !row.settable) {
    return undefined
  }
  const { choices, currentValue } = row.kind
  const next =
    choices[(choices.findIndex((choice) => choice.value === currentValue) + 1) % choices.length]
  return next && next.value !== currentValue ? next.value : undefined
}

/**
 * What each Droid key does in a chat. A key is claimed only while its action can run, so a key the
 * chat cannot act on keeps its ordinary job (Shift+Tab moving focus back) instead of going silent.
 * While a turn runs (`isWorking`, as for the pills) the four mode keys are claimed and do nothing.
 */
export function useNativeChatDroidComposerKeys(args: {
  agent: AgentType | undefined
  snapshot: readonly SessionOptionDescriptor[]
  surface: Pick<SessionOptionsSurface, 'setOption' | 'autonomy'> | null
  isWorking?: boolean | undefined
}): Partial<Record<DroidComposerKey, () => void>> | undefined {
  const { agent, snapshot, surface, isWorking = false } = args
  const isDroid = agent === 'droid'
  const spec = snapshot.find((row) => row.id === 'planMode')
  const specIsOn = spec?.kind.type === 'boolean' && spec.kind.currentValue === true
  const specCanSwitch = isDroid && spec?.kind.type === 'boolean' && spec.settable
  const autonomy = isDroid ? surface?.autonomy : undefined
  const nextLevel = autonomy?.settable
    ? nextDroidAutonomyLevel(autonomy.levels, autonomy.level)
    : undefined
  // With one level offered there is nothing to move to, so the key keeps its ordinary job.
  const levelToPick = nextLevel !== autonomy?.level ? nextLevel : undefined
  const effortToPick = isDroid
    ? nextChoiceValue(snapshot.find((row) => row.id === 'effort'))
    : undefined
  const modelToPick = isDroid
    ? nextChoiceValue(snapshot.find((row) => row.id === 'model'))
    : undefined
  const held = isDroid && isWorking
  return useMemo(() => {
    if (held) {
      return HELD_KEYS
    }
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
    if (effortToPick) {
      keys.tab = () => {
        void surface.setOption('effort', effortToPick)
      }
    }
    if (modelToPick) {
      keys.ctrlN = () => {
        void surface.setOption('model', modelToPick)
      }
    }
    return Object.keys(keys).length > 0 ? keys : undefined
  }, [effortToPick, held, levelToPick, modelToPick, specCanSwitch, specIsOn, surface])
}
