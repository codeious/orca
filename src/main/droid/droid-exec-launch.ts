import {
  ORCA_SCRUB_SAFE_LAUNCH_ENV,
  ORCA_SCRUB_SAFE_PANE_ENV
} from '../../shared/agent-hook-scrub-safe-env'
import {
  AGENT_HOOK_RUNTIME_ENV_KEYS,
  ORCA_AGENT_SESSION_CALLER_ENV_KEYS
} from '../ipc/pty/host-env/spawn-env-keys'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { structuredSessionChildIdentityEnv } from '../runtime/structured-session-child-identity-env'
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

// A pane's identity in the inherited environment would let Droid's own Orca status hooks report
// for this session too; the structured session is its one status producer.
const CHILD_ENV_TO_DELETE: readonly string[] = [
  'ORCA_PANE_KEY',
  'ORCA_TAB_ID',
  'ORCA_WORKTREE_ID',
  'ORCA_AGENT_LAUNCH_TOKEN',
  ORCA_SCRUB_SAFE_PANE_ENV,
  ORCA_SCRUB_SAFE_LAUNCH_ENV,
  ...AGENT_HOOK_RUNTIME_ENV_KEYS
]
const CALLER_ENV_TO_DELETE: readonly string[] = [
  ...ORCA_AGENT_SESSION_CALLER_ENV_KEYS,
  'ORCA_TERMINAL_HANDLE',
  'ORCA_AGENT_SESSION_SPAWN_TOKEN'
]

/** Droid keeps its own sessions; a resume goes through `droid.load_session` after the spawn. */
export function buildDroidExecLaunch(
  options: DroidExecLaunchOptions,
  orcaEnv: NodeJS.ProcessEnv = process.env
): ProviderProcessLaunch {
  const env = { ...options.env }
  for (const key of CALLER_ENV_TO_DELETE) {
    delete env[key]
  }
  const childEnv = options.structuredSession
    ? {
        ...structuredSessionChildIdentityEnv(options.structuredSession.id, env),
        ORCA_AGENT_SESSION_SPAWN_TOKEN: options.structuredSession.spawnToken
      }
    : env
  return {
    command: options.command,
    cwd: options.cwd,
    args: [...DROID_EXEC_ARGS],
    // Last, so a host value cannot turn the keychain back on for an isolated profile.
    env: { ...childEnv, ...droidKeyringEnvironment(orcaEnv) },
    envToDelete: [
      ...CHILD_ENV_TO_DELETE,
      ...(options.structuredSession
        ? Object.hasOwn(childEnv, 'ORCA_TERMINAL_HANDLE')
          ? []
          : ['ORCA_TERMINAL_HANDLE']
        : CALLER_ENV_TO_DELETE)
    ]
  }
}
