export { resolveDroidAccountHome } from './droid-account-home'
import type {
  StructuredAgentAdapterContext,
  StructuredAgentModelCatalogContext,
  StructuredAgentRuntimeAdapter,
  StructuredAgentRuntimeRegistration
} from '../runtime/structured-agent-runtime-registrations'
import { DROID_RUNTIME_METADATA } from './droid-runtime-metadata'
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
      ...(deps.readDroidInstallation ? { readVersion: deps.readDroidInstallation } : {}),
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
    onIdle: ({ sessionId }) => context.host()?.publishWorkChanged(sessionId),
    logger: deps.logger
  })
}

export const DROID_RUNTIME_REGISTRATION: StructuredAgentRuntimeRegistration = {
  ...DROID_RUNTIME_METADATA,
  createAdapter: createDroidAdapter
}
