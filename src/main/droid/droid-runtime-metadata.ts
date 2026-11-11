import { createDroidModelCatalogProbe } from './droid-model-catalog-probe'
import type { StructuredAgentCommandSettings } from '../native-chat/structured-agent-command-resolution'
import { resolveDroidCommand } from './droid-launch-resolution'
import { droidKeyringEnvironment } from './droid-environment'
import { DROID_CHAT_VERSION_FLOOR } from './droid-version-support'
import type { StructuredAgentRuntimeMetadata } from '../runtime/agent-session/installation/structured-agent-runtime-registration-types'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import { DROID_CLI_CONVERSATIONS } from './droid-cli-conversations'
import { DROID_AGENT } from './droid-agent-definition'
import { resolveDroidAccountHome } from './droid-account-home'

function resolveLaunch(env: Record<string, string>, settings: StructuredAgentCommandSettings) {
  return {
    ...resolveDroidCommand(env, settings),
    env: { ...env, ...droidKeyringEnvironment(process.env) }
  }
}

export const DROID_RUNTIME_METADATA: StructuredAgentRuntimeMetadata = {
  definition: DROID_AGENT,
  ...DROID_CLI_CONVERSATIONS,
  supportsLocation: supportsSupervisedProviderChildLocation,
  chatProgram: { resolve: resolveLaunch },
  launchCheck: { resolveLaunch, minimumVersions: [DROID_CHAT_VERSION_FLOOR] },
  modelCatalog: ({ deps, environment }) => ({
    kind: 'probe',
    listingNamesConfiguredModel: false,
    probe: createDroidModelCatalogProbe({
      resolveEnvironment: () => environment.resolveAgentEnvironment('droid'),
      ...(deps.resolveAgentCommandSettings
        ? { resolveCommandSettings: deps.resolveAgentCommandSettings }
        : {})
    })
  }),
  resolveAccountHome: async (request) => resolveDroidAccountHome(request)
}
