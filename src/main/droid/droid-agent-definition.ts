import type { DirectoryAccountAgentDefinition } from '../native-chat/agent-session-wire/structured-agent-definition'

export const DROID_HANDLE_TRANSPORT = 'droid-stream-jsonrpc'

// Droid reads its account from HOME and honours no variable that moves it, so the pin is a label
// only, named for Orca so no real setting of Droid's can ever be carried through it.
export const DROID_ACCOUNT_HOME_VARIABLE = 'ORCA_DROID_ACCOUNT_HOME'

export const DROID_AGENT: DirectoryAccountAgentDefinition = {
  agent: 'droid',
  handleTransport: DROID_HANDLE_TRANSPORT,
  accountHomeVariable: DROID_ACCOUNT_HOME_VARIABLE,
  capabilities: {
    rewind: false,
    compact: false,
    threadGoal: false,
    contextUsage: false,
    imagePrompts: false,
    steering: 'inject',
    approvalEnforcement: 'provider'
  },
  restingOptions: {
    // Model and effort are kept at rest and sent on the next start. Modes are not session options.
    acceptsKey: (key) => key === 'model' || key === 'effort',
    fallbackModels: () => null,
    effortDefaultsToModel: false
  }
}
