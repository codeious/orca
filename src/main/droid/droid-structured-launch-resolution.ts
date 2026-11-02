import { isAbsolute } from 'node:path'
import {
  agentSessionProviderHandleChainHead,
  type AgentSessionProviderHandleLink
} from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { isLegacyAgentSessionAccountHome } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session/journal/agent-session-journal-identity'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import type { readAgentCliVersion } from '../agent-launch/preflight/agent-cli-version-probe'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { AgentCliInstallationError } from '../native-chat/agent-cli-installation-error'
import type { StructuredAgentCommandSettings } from '../native-chat/structured-agent-command-resolution'
import { resolveAgentSessionLaunchDirectory } from '../runtime/agent-session/agent-session-launch-directory'
import type { AgentSessionRecordStore } from '../runtime/agent-session/records/agent-session-record-store'
import { isWindowsProcessStartTimeAvailable } from '../windows/windows-process-table'
import { DROID_ACCOUNT_HOME_VARIABLE, DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import type { DroidAutonomyLevel } from '../../shared/droid-autonomy-options'
import { droidAutonomyLevelFromLaunchArgs } from './droid-autonomy-level'
import { readDroidVersion, resolveDroidCommand } from './droid-launch-resolution'
import { isSupportedDroidVersion, unsupportedDroidRelease } from './droid-version-support'

export type DroidResolvedLaunch = {
  command: string
  prefixArgs?: readonly string[]
  cwd: string
  env: Record<string, string>
  /** The Droid session this chat last held; the start loads it rather than creating another. */
  previous: AgentSessionProviderHandleLink | null
  /** What Agent Permissions asks for now, sent on every start and resume. */
  autonomyLevel: DroidAutonomyLevel
}

export type DroidLaunchResolverDeps = {
  store: AgentSessionRecordStore
  resolveWorkspacePath: (id: string) => Promise<string>
  resolveEnvironment: () => Promise<NodeJS.ProcessEnv>
  /** The saved Droid Arguments, re-read per acquisition; Agent Permissions is the one copy of the level. */
  resolveLaunchArgs: () => Promise<readonly string[]> | readonly string[]
  /** The user's Droid Command setting, re-read per acquisition; none runs the stock binary. */
  resolveCommandSettings?: () => StructuredAgentCommandSettings
  resolveCommand?: typeof resolveCliCommand
  readVersion?: typeof readAgentCliVersion
  orcaEnv?: NodeJS.ProcessEnv
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
    const invocation = resolveDroidCommand(
      env,
      deps.resolveCommandSettings?.(),
      deps.resolveCommand
    )
    const { command } = invocation
    // Again at every launch: the binary on PATH may have changed since the chat was created.
    const version = await readDroidVersion(
      { ...invocation, cwd, env },
      deps.readVersion,
      deps.orcaEnv
    )
    // Why: a bare name means nothing is installed, which the spawn refuses in words a person can act on.
    const unreadable = version === null && isAbsolute(command)
    if (unreadable || (version !== null && !isSupportedDroidVersion(version))) {
      const older = version === null ? null : unsupportedDroidRelease(version)
      throw older
        ? new AgentCliInstallationError(older)
        : new AgentSessionPreSpawnError(
            new Error('Droid release is not supported for structured chat')
          )
    }
    return { ...invocation, cwd, env, previous, autonomyLevel }
  }
}

export function droidProviderLink(
  launch: Pick<DroidResolvedLaunch, 'previous'>,
  sessionId: string,
  fence: number,
  linkId: string,
  at: number
): AgentSessionProviderHandleLink {
  const { previous } = launch
  if (previous && previous.handle.nativeId !== sessionId) {
    throw new Error('Droid loaded a different session')
  }
  return {
    linkId,
    handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: sessionId },
    origin: previous ? 'resumed' : 'created',
    mintedAtFence: fence,
    observedAt: at
  }
}
