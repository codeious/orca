import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  agentSessionAccountHome,
  type LegacyAgentSessionAccountHome
} from '../../shared/agent-session-account-home'
import { isAgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import type {
  StructuredAgentAdapterContext,
  StructuredAgentLaunchCheckInput,
  StructuredAgentModelCatalogContext,
  StructuredAgentRuntimeAdapter,
  StructuredAgentRuntimeRegistration
} from '../runtime/structured-agent-runtime-registrations'
import { DROID_AGENT } from './droid-agent-definition'
import { createDroidModelCatalogProbe } from './droid-model-catalog-probe'
import {
  droidUnsupportedVersion,
  droidVersionSupported,
  resolveDroidCommand
} from './droid-launch-resolution'
import { DroidSessionAdapter } from './droid-session-adapter'
import { createDroidLaunchResolver } from './droid-structured-launch-resolution'

/** The environment every Droid child starts from: a chat's launch and a model listing alike. */
function droidEnvironment({
  deps,
  environment
}: StructuredAgentModelCatalogContext): () => Promise<NodeJS.ProcessEnv> {
  return async () => ({
    ...(await environment.resolveBaseEnvironment()),
    ...deps.resolveAgentLaunchEnv?.('droid')
  })
}

function createDroidAdapter(context: StructuredAgentAdapterContext): StructuredAgentRuntimeAdapter {
  const { deps } = context
  return new DroidSessionAdapter({
    resolveLaunch: createDroidLaunchResolver({
      store: context.store,
      resolveWorkspacePath: deps.resolveWorkspacePath,
      resolveEnvironment: droidEnvironment(context),
      resolveLaunchArgs: () => deps.resolveLaunchArgs('droid'),
      ...(deps.resolveAgentCommandSettings
        ? { resolveCommandSettings: deps.resolveAgentCommandSettings }
        : {})
    }),
    ...(deps.openDroidConnection ? { openConnection: deps.openDroidConnection } : {}),
    ...(deps.readProcessStartTime ? { readProcessStartTime: deps.readProcessStartTime } : {}),
    onLifecycle: context.deliverLifecycle,
    onSettled: ({ sessionId, clientMessageId, outcome }) => {
      if (outcome.state === 'admitted') {
        return
      }
      context.followUps.onDispatchSettledLate({
        sessionId,
        clientMessageId,
        ...(outcome.state === 'accepted' ? { providerIdentity: outcome.providerIdentity } : outcome)
      })
    },
    onIdle: context.followUps.releaseUnansweredDispatches,
    logger: deps.logger
  })
}

/** The installed binary the launch would spawn. Null when there is none to read a release from:
 *  the Command setting cannot run, or no droid is installed. The launch itself refuses both with
 *  words a person can act on, so neither falls to a terminal. */
function launchedDroid({ env, commandSettings }: StructuredAgentLaunchCheckInput): string | null {
  try {
    const command = resolveDroidCommand(env, commandSettings)
    // Resolution hands back the bare name when nothing is installed.
    return isAbsolute(command) ? command : null
  } catch (error) {
    if (isAgentSessionPreSpawnError(error)) {
      return null
    }
    throw error
  }
}

/** Droid reads its account from HOME and honours no variable that moves it; the pin is a label. */
export function resolveDroidAccountHome({
  launchEnv
}: {
  launchEnv: NodeJS.ProcessEnv
}): LegacyAgentSessionAccountHome {
  const home = launchEnv.HOME?.trim() || launchEnv.USERPROFILE?.trim() || homedir()
  return agentSessionAccountHome(DROID_AGENT, join(home, '.factory'))
}

export const DROID_RUNTIME_REGISTRATION: StructuredAgentRuntimeRegistration = {
  definition: DROID_AGENT,
  createAdapter: createDroidAdapter,
  modelCatalog: (context) => ({
    kind: 'probe',
    // The list does not mark the model a new chat runs. A no-pick session teaches that.
    listingNamesConfiguredModel: false,
    probe: createDroidModelCatalogProbe({
      resolveEnvironment: droidEnvironment(context),
      ...(context.deps.resolveAgentCommandSettings
        ? { resolveCommandSettings: context.deps.resolveAgentCommandSettings }
        : {})
    })
  }),
  supportsLocation: supportsSupervisedProviderChildLocation,
  supportsLaunch: async (launch) => {
    const command = launchedDroid(launch)
    return command === null || droidVersionSupported({ ...launch, command })
  },
  unsupportedVersion: async (launch) => {
    const command = launchedDroid(launch)
    return command === null ? null : droidUnsupportedVersion({ ...launch, command })
  },
  resolveAccountHome: async (request) => resolveDroidAccountHome(request)
}
