import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
import { requireLegacyAgentSessionAccountHome } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import type { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import type { AgentCliVersionReader } from '../agent-launch/preflight/agent-cli-version-probe'
import { AgentModelCatalogListingStoppedError } from '../native-chat/agent-model-catalog/agent-model-catalog-failures'
import { AGENT_MODEL_CATALOG_PROBE_TIMEOUT_MS } from '../native-chat/agent-model-catalog/agent-model-catalog-probe-runner'
import type {
  AgentModelCatalogProbe,
  AgentModelCatalogSuccess
} from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import type { StructuredAgentCommandSettings } from '../native-chat/structured-agent-command-resolution'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { DroidAgentConnection } from './droid-agent-connection'
import { buildDroidExecLaunch } from './droid-exec-launch'
import { droidVersionSupported, resolveDroidCommand } from './droid-launch-resolution'
import { droidModelOptionsFromListing } from './droid-model-options'

type DroidModelCatalogConnection = {
  request(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number | null }
  ): Promise<unknown>
  close(): Promise<unknown>
}

export type DroidModelCatalogProbeDeps = {
  resolveEnvironment: () => Promise<NodeJS.ProcessEnv>
  resolveCommandSettings?: () => StructuredAgentCommandSettings
  resolveCommand?: typeof resolveCliCommand
  /** Test seams. Production runs `droid --version`, then `droid.list_models` with no session. */
  probeVersion?: AgentCliVersionReader
  homePath?: string
  orcaEnv?: NodeJS.ProcessEnv
  openConnection?: (launch: ProviderProcessLaunch) => DroidModelCatalogConnection
}

function openDroidModelCatalog(launch: ProviderProcessLaunch): DroidModelCatalogConnection {
  return new DroidAgentConnection(launch, {})
}

/** Droid reads its account from HOME. The catalog key is the `.factory` directory under it. */
function pinDroidAccountHome(env: Record<string, string>, accountPath: string): void {
  if (basename(accountPath) !== '.factory') {
    return
  }
  const home = dirname(accountPath)
  env.HOME = home
  env.USERPROFILE = home
}

async function configuredDroidDefaults(
  accountPath: string
): Promise<Pick<AgentModelCatalogSuccess, 'configured' | 'configuredSpec'>> {
  try {
    const settings: unknown = JSON.parse(await readFile(join(accountPath, 'settings.json'), 'utf8'))
    if (!isRecord(settings)) {
      return {}
    }
    const defaults = isRecord(settings.sessionDefaultSettings)
      ? settings.sessionDefaultSettings
      : {}
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value : undefined
    const model = text(defaults.model) ?? text(settings.model)
    const effort = text(defaults.reasoningEffort) ?? text(settings.reasoningEffort)
    const specModel = text(defaults.specModeModel)
    const specEffort = text(defaults.specModeReasoningEffort)
    return {
      ...(model ? { configured: { model, ...(effort ? { effort } : {}) } } : {}),
      ...(specModel
        ? { configuredSpec: { model: specModel, ...(specEffort ? { effort: specEffort } : {}) } }
        : {})
    }
  } catch {
    return {}
  }
}

/** Lists models with `droid.list_models` and no session. `initialize_session` would store one. */
export function createDroidModelCatalogProbe(
  deps: DroidModelCatalogProbeDeps
): AgentModelCatalogProbe {
  return async (accountHome, options): Promise<AgentModelCatalogSuccess> => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(await deps.resolveEnvironment())) {
      if (value !== undefined) {
        env[key] = value
      }
    }
    const accountPath = requireLegacyAgentSessionAccountHome(accountHome).path
    pinDroidAccountHome(env, accountPath)
    const invocation = resolveDroidCommand(
      env,
      deps.resolveCommandSettings?.(),
      deps.resolveCommand
    )
    const { command } = invocation
    const cwd = deps.homePath ?? homedir()
    if (
      !(await droidVersionSupported({ ...invocation, cwd, env }, deps.probeVersion, deps.orcaEnv))
    ) {
      throw new Error(`droid at ${command} does not run structured chats`)
    }
    // No structured-session identity: this child is not a chat and must not store one.
    const launch = buildDroidExecLaunch({ ...invocation, cwd, env }, deps.orcaEnv)
    const connection = (deps.openConnection ?? openDroidModelCatalog)(launch)
    const abort = (): void => {
      void connection.close()
    }
    if (options?.signal?.aborted) {
      await connection.close()
      throw new AgentModelCatalogListingStoppedError('Droid model listing stopped')
    }
    options?.signal?.addEventListener('abort', abort, { once: true })
    try {
      const result = await connection.request(
        'droid.list_models',
        {},
        {
          timeoutMs: AGENT_MODEL_CATALOG_PROBE_TIMEOUT_MS
        }
      )
      const models = droidModelOptionsFromListing(result)
      if (models.length === 0) {
        throw new Error('droid listed no models')
      }
      return { models, origin: 'probe', ...(await configuredDroidDefaults(accountPath)) }
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new AgentModelCatalogListingStoppedError('Droid model listing stopped')
      }
      throw error
    } finally {
      options?.signal?.removeEventListener('abort', abort)
      await connection.close().catch(() => {})
    }
  }
}
