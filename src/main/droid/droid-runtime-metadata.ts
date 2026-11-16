import type { StructuredAgentRuntimeMetadata } from '../runtime/agent-session/installation/structured-agent-runtime-registration-types'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import { DROID_CLI_CONVERSATIONS } from './droid-cli-conversations'
import { DROID_AGENT } from './droid-agent-definition'
import { resolveDroidAccountHome } from './droid-account-home'

export const DROID_RUNTIME_METADATA: StructuredAgentRuntimeMetadata = {
  definition: DROID_AGENT,
  ...DROID_CLI_CONVERSATIONS,
  supportsLocation: supportsSupervisedProviderChildLocation,
  modelCatalog: () => ({ kind: 'unavailable', reason: 'Model discovery is not available yet' }),
  resolveAccountHome: async (request) => resolveDroidAccountHome(request)
}
