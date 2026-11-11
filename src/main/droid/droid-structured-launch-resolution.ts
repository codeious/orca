import { agentSessionProviderHandleChainHead } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { isLegacyAgentSessionAccountHome } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session/journal/agent-session-journal-identity'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import {
  resolveStructuredAgentCommand,
  type StructuredAgentCommandSettings
} from '../native-chat/structured-agent-command-resolution'
import { resolveAgentSessionLaunchDirectory } from '../runtime/agent-session/agent-session-launch-directory'
import type { AgentSessionRecordStore } from '../runtime/agent-session/records/agent-session-record-store'
import { isWindowsProcessStartTimeAvailable } from '../windows/windows-process-table'
import { DROID_ACCOUNT_HOME_VARIABLE, DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { droidAutonomyLevelFromLaunchArgs } from './droid-autonomy-level'

import type { DroidResolvedLaunch } from './droid-session-launch-contract'

export type DroidLaunchResolverDeps = {
  store: AgentSessionRecordStore
  resolveWorkspacePath: (id: string) => Promise<string>
  resolveEnvironment: () => Promise<NodeJS.ProcessEnv>
  /** The saved Droid Arguments, re-read per acquisition; Agent Permissions is the one copy of the level. */
  resolveLaunchArgs: () => Promise<readonly string[]> | readonly string[]
  /** The user's Droid Command setting, re-read per acquisition; none runs the stock binary. */
  resolveCommandSettings?: () => StructuredAgentCommandSettings
  resolveCommand?: typeof resolveCliCommand
}

/** Reads the execution host's durable record; never resolves another host's files or account. */
export function createDroidLaunchResolver(
  deps: DroidLaunchResolverDeps
): (identity: AgentSessionJournalIdentity) => Promise<DroidResolvedLaunch> {
  return async (identity) => {
    const record = deps.store.getRecord(identity.sessionId)
    if (!record || record.provider !== 'droid') {
      throw new Error('Droid session record unavailable')
    }
    if (
      record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
      record.location.wslDistro !== null
    ) {
      throw new Error('Droid structured session belongs to another execution host')
    }
    if (process.platform === 'win32' && !isWindowsProcessStartTimeAvailable()) {
      throw new Error('Droid structured sessions require Windows process creation-time proof')
    }
    const { accountHome } = record
    if (
      !isLegacyAgentSessionAccountHome(accountHome) ||
      accountHome.variable !== DROID_ACCOUNT_HOME_VARIABLE
    ) {
      throw new Error('Droid account home does not match its binary')
    }
    const previous = agentSessionProviderHandleChainHead(record.providerHandleChain)
    if (
      previous &&
      (previous.handle.transport !== DROID_HANDLE_TRANSPORT ||
        previous.handle.agent !== 'droid' ||
        previous.handle.nativeId.length === 0)
    ) {
      throw new Error('Droid resume handle is not a Droid session')
    }
    const cwd = await resolveAgentSessionLaunchDirectory(deps, record)
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(await deps.resolveEnvironment())) {
      if (value !== undefined) {
        env[key] = value
      }
    }
    const autonomyLevel = droidAutonomyLevelFromLaunchArgs(await deps.resolveLaunchArgs())
    const homePath = env.HOME ?? env.USERPROFILE
    const invocation = resolveStructuredAgentCommand(
      'droid',
      {},
      {
        pathEnv: env.PATH ?? env.Path ?? null,
        ...(homePath ? { homePath } : {})
      }
    )
    return { ...invocation, cwd, env, previous, autonomyLevel }
  }
}
