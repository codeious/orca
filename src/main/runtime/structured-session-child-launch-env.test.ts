import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCA_SCRUB_SAFE_LAUNCH_ENV,
  ORCA_SCRUB_SAFE_PANE_ENV
} from '../../shared/agent-hook-scrub-safe-env'
import { AGENT_HOOK_RUNTIME_ENV_KEYS } from '../ipc/pty/host-env/spawn-env-keys'
import { resolveProviderChildEnv } from '../provider-process/provider-process-launch'
import { STRUCTURED_CHILD_PANE_ENV_TO_DELETE } from './structured-child-pane-env-scrub'
import { structuredSessionChildLaunchEnv } from './structured-session-child-launch-env'

const worker = vi.hoisted((): { handle: string | null } => ({ handle: null }))
vi.mock('./structured-worker-authority', () => ({
  resolveStructuredWorkerIdentityForSession: () =>
    worker.handle ? { handle: worker.handle } : null
}))

// Frozen so one test mutating it cannot make a later "left untouched" check compare it to itself.
const inherited = Object.freeze({
  ORCA_AGENT_SESSION_ID: 'stale',
  ORCA_STRUCTURED_SESSION: '1',
  ORCA_TERMINAL_HANDLE: 'structworker_stale',
  ORCA_AGENT_SESSION_SPAWN_TOKEN: 'old-token'
})

describe('the environment a structured session child launches with', () => {
  beforeEach(() => {
    worker.handle = null
  })

  it('strips the pane, tab, worktree and hook identity of whoever started Orca', () => {
    const { envToDelete } = structuredSessionChildLaunchEnv({})

    expect(envToDelete).toEqual(expect.arrayContaining([...STRUCTURED_CHILD_PANE_ENV_TO_DELETE]))
    expect(envToDelete).toEqual(
      expect.arrayContaining([
        'ORCA_PANE_KEY',
        'ORCA_TAB_ID',
        'ORCA_WORKTREE_ID',
        'ORCA_AGENT_LAUNCH_TOKEN',
        ORCA_SCRUB_SAFE_PANE_ENV,
        ORCA_SCRUB_SAFE_LAUNCH_ENV,
        ...AGENT_HOOK_RUNTIME_ENV_KEYS
      ])
    )
  })

  it('without a session, drops every caller identity key from the overlay and the inherited env', () => {
    const { env, envToDelete } = structuredSessionChildLaunchEnv({
      env: { ...inherited, FACTORY_API_KEY: 'host-key' }
    })

    expect(env).toEqual({ FACTORY_API_KEY: 'host-key' })
    expect(envToDelete).toEqual(expect.arrayContaining(Object.keys(inherited)))
    expect(
      resolveProviderChildEnv({ env, envToDelete }, { ...inherited, PATH: '/usr/bin' })
    ).toEqual({ FACTORY_API_KEY: 'host-key', PATH: '/usr/bin' })
  })

  it('gives a session its own identity over a stale inherited one', () => {
    const { env } = structuredSessionChildLaunchEnv({
      env: { ...inherited },
      structuredSession: { id: 'this-session', spawnToken: 'this-token' }
    })

    expect(env).toMatchObject({
      ORCA_AGENT_SESSION_ID: 'this-session',
      ORCA_STRUCTURED_SESSION: '1',
      ORCA_AGENT_SESSION_SPAWN_TOKEN: 'this-token'
    })
    expect(env).not.toHaveProperty('ORCA_TERMINAL_HANDLE')
  })

  it('strips an inherited terminal handle when the session has no worker handle of its own', () => {
    const { env, envToDelete } = structuredSessionChildLaunchEnv({
      structuredSession: { id: 'this-session', spawnToken: 'this-token' }
    })

    expect(envToDelete).toContain('ORCA_TERMINAL_HANDLE')
    expect(resolveProviderChildEnv({ env, envToDelete }, inherited)).not.toHaveProperty(
      'ORCA_TERMINAL_HANDLE'
    )
  })

  it('keeps the worker handle the session was minted', () => {
    worker.handle = 'structworker_this'
    const { env, envToDelete } = structuredSessionChildLaunchEnv({
      structuredSession: { id: 'this-session', spawnToken: 'this-token' }
    })

    expect(envToDelete).not.toContain('ORCA_TERMINAL_HANDLE')
    expect(resolveProviderChildEnv({ env, envToDelete }, inherited).ORCA_TERMINAL_HANDLE).toBe(
      'structworker_this'
    )
  })

  it('leaves the caller overlay untouched', () => {
    const overlay = { ...inherited }

    structuredSessionChildLaunchEnv({
      env: overlay,
      structuredSession: { id: 'this-session', spawnToken: 'this-token' }
    })

    expect(overlay).toEqual(inherited)
  })
})
