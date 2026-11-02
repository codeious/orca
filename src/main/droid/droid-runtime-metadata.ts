import type { StructuredAgentRuntimeMetadata } from '../runtime/structured-agent-runtime-registration-types'
import type { StructuredAgentCommandSettings } from '../native-chat/structured-agent-command-resolution'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import { DROID_AGENT } from './droid-agent-definition'
import { resolveDroidAccountHome } from './droid-account-home'
import { createDroidModelCatalogProbe } from './droid-model-catalog-probe'
import { resolveDroidCommand } from './droid-launch-resolution'
import { droidKeyringEnvironment } from './droid-environment'
import { DROID_CHAT_VERSION_FLOOR } from './droid-version-support'

function resolveLaunch(env: Record<string, string>, settings: StructuredAgentCommandSettings) {
  return {
    ...resolveDroidCommand(env, settings),
    env: { ...env, ...droidKeyringEnvironment(process.env) }
  }
}

export const DROID_RUNTIME_METADATA: StructuredAgentRuntimeMetadata = {
  definition: DROID_AGENT,
  transcriptImport: null,
  sessionHistory: {
    rowAgents: ['droid'],
    rowSessionId: (link) => link.handle.nativeId,
    parseResumeArgs: () => null
  },
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
