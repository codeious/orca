import { describe, expect, it } from 'vitest'
import { resolveProviderChildEnv } from '../provider-process/provider-process-launch'
import { buildDroidExecLaunch } from './droid-exec-launch'

const options = { command: 'host-resolved-droid', cwd: '/host/folder' }
const isolated = { ORCA_E2E_USER_DATA_DIR: '/tmp/e2e-profile' }

describe('the droid exec launch', () => {
  it('runs the host-resolved binary in the folder over stream-jsonrpc, and nothing else', () => {
    expect(buildDroidExecLaunch(options, {})).toMatchObject({
      command: 'host-resolved-droid',
      cwd: '/host/folder',
      args: ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc']
    })
  })

  it('keeps the environment the host resolved and strips the pane and hook identity of whoever started Orca', () => {
    const launch = buildDroidExecLaunch(
      {
        ...options,
        env: { FACTORY_API_KEY: 'host-key', ORCA_PANE_KEY: 'other-pane', ORCA_AGENT_HOOK_PORT: '1' }
      },
      {}
    )

    const env = resolveProviderChildEnv(launch, {
      ORCA_AGENT_HOOK_TOKEN: 'inherited',
      ORCA_TAB_ID: 'tab',
      ORCA_WORKTREE_ID: 'tree',
      ORCA_AGENT_LAUNCH_TOKEN: 'token',
      ORCA_AGENT_SESSION_ID: 'inherited-session',
      ORCA_STRUCTURED_SESSION: '1',
      PATH: '/usr/bin'
    })

    expect(env).toEqual({ FACTORY_API_KEY: 'host-key', PATH: '/usr/bin' })
  })

  it('gives a structured session its own identity and never a pane or hook one', () => {
    const launch = buildDroidExecLaunch(
      { ...options, structuredSession: { id: 'session-1', spawnToken: 'spawn-1' } },
      {}
    )

    const env = resolveProviderChildEnv(launch, {
      ORCA_PANE_KEY: 'inherited-pane',
      ORCA_AGENT_HOOK_PORT: '9'
    })

    expect(env).toMatchObject({
      ORCA_AGENT_SESSION_ID: 'session-1',
      ORCA_STRUCTURED_SESSION: '1',
      ORCA_AGENT_SESSION_SPAWN_TOKEN: 'spawn-1'
    })
    expect(env).not.toHaveProperty('ORCA_PANE_KEY')
    expect(env).not.toHaveProperty('ORCA_AGENT_HOOK_PORT')
  })

  it('keeps the login keychain out of an isolated profile and leaves a real profile alone', () => {
    expect(resolveProviderChildEnv(buildDroidExecLaunch(options, isolated), {})).toMatchObject({
      FACTORY_DISABLE_KEYRING: '1'
    })
    expect(resolveProviderChildEnv(buildDroidExecLaunch(options, {}), {})).not.toHaveProperty(
      'FACTORY_DISABLE_KEYRING'
    )
  })

  it('does not let the host environment turn the keychain back on in an isolated profile', () => {
    const launch = buildDroidExecLaunch(
      { ...options, env: { FACTORY_DISABLE_KEYRING: '0' } },
      isolated
    )

    expect(resolveProviderChildEnv(launch, {}).FACTORY_DISABLE_KEYRING).toBe('1')
  })
})
