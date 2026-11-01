import { ORCA_AGENT_SESSION_CALLER_ENV_KEYS } from '../ipc/pty/host-env/spawn-env-keys'
import { STRUCTURED_CHILD_PANE_ENV_TO_DELETE } from './structured-child-pane-env-scrub'
import { structuredSessionChildIdentityEnv } from './structured-session-child-identity-env'

const CALLER_ENV_TO_DELETE: readonly string[] = [
  ...ORCA_AGENT_SESSION_CALLER_ENV_KEYS,
  'ORCA_TERMINAL_HANDLE',
  'ORCA_AGENT_SESSION_SPAWN_TOKEN'
]

/** The overlay and strip list a structured session's own JSON-RPC child launches with. */
export function structuredSessionChildLaunchEnv(options: {
  env?: Record<string, string>
  structuredSession?: { id: string; spawnToken: string }
}): { env: Record<string, string>; envToDelete: string[] } {
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
    env: childEnv,
    envToDelete: [
      ...STRUCTURED_CHILD_PANE_ENV_TO_DELETE,
      ...(options.structuredSession
        ? Object.hasOwn(childEnv, 'ORCA_TERMINAL_HANDLE')
          ? []
          : ['ORCA_TERMINAL_HANDLE']
        : CALLER_ENV_TO_DELETE)
    ]
  }
}
