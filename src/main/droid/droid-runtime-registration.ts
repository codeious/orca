import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { agentSessionAccountHome } from '../../shared/agent-session-account-home'
import { isAgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import type {
  StructuredAgentAdapterContext,
  StructuredAgentLaunchCheckInput,
  StructuredAgentRuntimeAdapter,
  StructuredAgentRuntimeRegistration
} from '../runtime/structured-agent-runtime-registrations'
import { DROID_AGENT } from './droid-agent-definition'
import {
  droidUnsupportedVersion,
  droidVersionSupported,
  resolveDroidCommand
} from './droid-launch-resolution'
import { DroidSessionAdapter } from './droid-session-adapter'
import { createDroidLaunchResolver } from './droid-structured-launch-resolution'

function createDroidAdapter(context: StructuredAgentAdapterContext): StructuredAgentRuntimeAdapter {
  const { deps } = context
  return new DroidSessionAdapter({
    resolveLaunch: createDroidLaunchResolver({
      store: context.store,
      resolveWorkspacePath: deps.resolveWorkspacePath,
      resolveEnvironment: async () => ({
        ...(await context.environment.resolveBaseEnvironment()),
        ...deps.resolveAgentLaunchEnv?.('droid')
      }),
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
export function resolveDroidAccountHome({ launchEnv }: { launchEnv: NodeJS.ProcessEnv }) {
  const home = launchEnv.HOME?.trim() || launchEnv.USERPROFILE?.trim() || homedir()
  return agentSessionAccountHome(DROID_AGENT, join(home, '.factory'))
}

export const DROID_RUNTIME_REGISTRATION: StructuredAgentRuntimeRegistration = {
  definition: DROID_AGENT,
  createAdapter: createDroidAdapter,
  modelCatalog: () => ({
    kind: 'unavailable',
    reason: 'Droid lists its models over a session it runs'
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
