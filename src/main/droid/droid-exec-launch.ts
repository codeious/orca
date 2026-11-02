import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import {
  sealStructuredSessionChild,
  STRUCTURED_CHILD_ENV_TO_DELETE
} from '../runtime/structured-session-child-env'
import { ORCA_AGENT_SESSION_CALLER_ENV_KEYS } from '../ipc/pty/host-env/spawn-env-keys'
import { droidKeyringEnvironment } from './droid-environment'

export type DroidExecLaunchOptions = {
  /** Binary and folder are resolved by the execution host before building the launch. */
  command: string
  prefixArgs?: readonly string[]
  cwd: string
  env?: Record<string, string>
  structuredSession?: { id: string; spawnToken: string }
}

const DROID_EXEC_ARGS: readonly string[] = [
  'exec',
  '--input-format',
  'stream-jsonrpc',
  '--output-format',
  'stream-jsonrpc'
]

/** Droid keeps its own sessions; a resume goes through `droid.load_session` after the spawn. */
export function buildDroidExecLaunch(
  options: DroidExecLaunchOptions,
  orcaEnv: NodeJS.ProcessEnv = process.env
): ProviderProcessLaunch {
  const inheritedEnvToDelete = [
    ...STRUCTURED_CHILD_ENV_TO_DELETE,
    ...ORCA_AGENT_SESSION_CALLER_ENV_KEYS,
    'ORCA_TERMINAL_HANDLE'
  ]
  const { env, envToDelete } = options.structuredSession
    ? sealStructuredSessionChild({
        sessionId: options.structuredSession.id,
        spawnToken: options.structuredSession.spawnToken,
        env: { ...options.env },
        inheritedEnvToDelete
      })
    : { env: { ...options.env }, envToDelete: inheritedEnvToDelete }
  return {
    command: options.command,
    cwd: options.cwd,
    args: [...(options.prefixArgs ?? []), ...DROID_EXEC_ARGS],
    // Last, so a host value cannot turn the keychain back on for an isolated profile.
    env: { ...env, ...droidKeyringEnvironment(orcaEnv) },
    envToDelete
  }
}
