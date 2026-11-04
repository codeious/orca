import type { DirectoryAccountAgentDefinition } from '../native-chat/agent-session-wire/structured-agent-definition'
import { droidRewindMessageTarget } from './droid-rewind-target'
import {
  DROID_AUTONOMY_LEVELS,
  DROID_AUTONOMY_OPTION_ID,
  droidAutonomyLevelFromSavedOptions
} from '../../shared/droid-autonomy-options'
import { droidAutonomyOptionDescriptor } from './droid-session-option-descriptors'
import { droidAutonomyLevelFromLaunchArgs } from './droid-autonomy-level'
import {
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_EFFORT_OPTION_ID
} from '../../shared/droid-spec-pair-options'

export const DROID_HANDLE_TRANSPORT = 'droid-stream-jsonrpc'

// Droid reads its account from HOME and honours no variable that moves it, so the pin is a label
// only, named for Orca so no real setting of Droid's can ever be carried through it.
export const DROID_ACCOUNT_HOME_VARIABLE = 'ORCA_DROID_ACCOUNT_HOME'

export const DROID_AGENT: DirectoryAccountAgentDefinition = {
  agent: 'droid',
  handleTransport: DROID_HANDLE_TRANSPORT,
  accountHomeVariable: DROID_ACCOUNT_HOME_VARIABLE,
  rewindMessageTarget: droidRewindMessageTarget,
  capabilities: {
    rewind: true,
    compact: true,
    threadGoal: false,
    // The ring reads Droid's own context breakdown after each turn.
    contextUsage: true,
    imagePrompts: false,
    steering: 'inject',
    approvalEnforcement: 'provider'
  },
  restingOptions: {
    acceptsKey: (key) =>
      key === 'model' ||
      key === 'effort' ||
      key === 'planMode' ||
      key === DROID_AUTONOMY_OPTION_ID ||
      key === DROID_SPEC_MODEL_OPTION_ID ||
      key === DROID_SPEC_EFFORT_OPTION_ID,
    fallbackModels: () => null,
    effortDefaultsToModel: false,
    sessionOptions: ({ saved, launchArgs }) => {
      const picked = droidAutonomyLevelFromSavedOptions(saved)
      return [
        {
          ...droidAutonomyOptionDescriptor(
            picked ?? droidAutonomyLevelFromLaunchArgs(launchArgs),
            DROID_AUTONOMY_LEVELS
          ),
          valueSource: picked === undefined ? 'default' : 'applied'
        }
      ]
    }
  }
}
