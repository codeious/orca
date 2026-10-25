import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { structuredSessionChildLaunchEnv } from '../runtime/structured-session-child-launch-env'
import { droidKeyringEnvironment } from './droid-environment'

export type DroidExecLaunchOptions = {
  /** Binary and folder are resolved by the execution host before building the launch. */
  command: string
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
  const { env, envToDelete } = structuredSessionChildLaunchEnv(options)
  return {
    command: options.command,
    cwd: options.cwd,
    args: [...DROID_EXEC_ARGS],
    // Last, so a host value cannot turn the keychain back on for an isolated profile.
    env: { ...env, ...droidKeyringEnvironment(orcaEnv) },
    envToDelete
  }
}
