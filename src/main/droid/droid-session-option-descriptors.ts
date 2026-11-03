import type { AgentSessionOptionsResult } from '../../shared/agent-session/options/agent-session-options-result'
import type {
  SessionOptionDescriptor,
  SessionOptionSelectChoice
} from '../../shared/native-chat/input/native-chat-session-options'
import {
  DROID_AUTONOMY_OPTION_ID,
  type DroidAutonomyLevel
} from '../../shared/droid-autonomy-options'
import {
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_EFFORT_OPTION_ID,
  DROID_SPEC_SAME_AS_MAIN
} from '../../shared/droid-spec-pair-options'
import type { DroidSettings } from './droid-session-settings'

function select(
  id: string,
  label: string,
  currentValue: string | undefined,
  choices: SessionOptionSelectChoice[],
  settable = true
): SessionOptionDescriptor {
  return {
    id,
    label,
    scope: 'session',
    category: 'mode',
    transport: 'agent-session',
    valueSource: currentValue === undefined ? 'unknown' : 'reported',
    settable,
    kind: { type: 'select', choices, ...(currentValue === undefined ? {} : { currentValue }) }
  }
}

const autonomyChoices: Record<DroidAutonomyLevel, SessionOptionSelectChoice> = {
  off: { value: 'off', label: 'Off', description: 'Asks before edits and commands' },
  low: {
    value: 'low',
    label: 'Low',
    description: 'Edits files and runs read-only commands; asks for the rest'
  },
  medium: {
    value: 'medium',
    label: 'Medium',
    description:
      'Also runs reversible commands like installs, builds and local commits; asks for the rest'
  },
  high: {
    value: 'high',
    label: 'High',
    description: 'Runs commands without asking, except ones Droid blocks'
  }
}

export function droidAutonomyOptionDescriptor(
  currentValue: DroidAutonomyLevel | undefined,
  levels: readonly DroidAutonomyLevel[]
): SessionOptionDescriptor {
  return select(
    DROID_AUTONOMY_OPTION_ID,
    'Permissions',
    currentValue,
    levels.map((value) => autonomyChoices[value]),
    levels.length > 0
  )
}

/** Only the provider's offered levels and models become writable choices. */
export function droidSessionOptionDescriptors(
  settings: DroidSettings,
  options: AgentSessionOptionsResult
): SessionOptionDescriptor[] {
  const levels = settings.availableAutonomyLevels ?? []
  const rows: SessionOptionDescriptor[] =
    settings.autonomyLevel || levels.length
      ? [droidAutonomyOptionDescriptor(settings.autonomyLevel, levels)]
      : []
  const same = { value: DROID_SPEC_SAME_AS_MAIN, label: 'Same as main' }
  const model = settings.specModeModelId
  const effort = settings.specModeReasoningEffort
  const efforts =
    options.models.find((row) => row.id === (model ?? options.current.model))?.efforts ?? []
  rows.push(
    select(DROID_SPEC_MODEL_OPTION_ID, 'Spec model', model ?? DROID_SPEC_SAME_AS_MAIN, [
      same,
      ...options.models.map((row) => ({ value: row.id, label: row.label }))
    ]),
    select(
      DROID_SPEC_EFFORT_OPTION_ID,
      'Spec reasoning effort',
      effort ?? DROID_SPEC_SAME_AS_MAIN,
      [same, ...efforts]
    )
  )
  return rows
}
