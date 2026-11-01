import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildPtyHostEnvOptions } from './types'

const fixture = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => fixture.userData, onWillQuit: vi.fn() })
}))
vi.mock('../../../agent-hooks/server', () => ({
  agentHookServer: { buildPtyEnv: () => ({}) }
}))
vi.mock('../../../agent-hooks/wsl-hook-relay-manager', () => ({
  wslHookRelayManager: {
    ensureForDistro: vi.fn(),
    getGuestEndpointFilePath: () => null,
    getOpenCodeOverlayDir: () => null,
    getGuestAgentPath: () => null
  }
}))
vi.mock('../../../pi/titlebar-extension-service', () => ({
  piTitlebarExtensionService: { buildPtyEnv: () => ({}), buildFreshOmpEnv: () => ({}) }
}))
vi.mock('../../../cli/orca-cli-child-path', () => ({ prependOrcaCliDirToChildPath: () => {} }))
vi.mock('../../../codex/codex-hook-reconcile', () => ({ scheduleCodexHookReconcile: () => {} }))

import { buildPtyHostEnv } from './assembly'

// Why this file: a Droid terminal launched from an isolated profile (an e2e or QA run) must not
// reach for the login keychain, the same as the structured session and the version probe.

let root: string
let options: BuildPtyHostEnvOptions

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-droid-terminal-env-'))
  fixture.userData = join(root, 'user-data')
  vi.stubEnv('HOME', join(root, 'home'))
  vi.stubEnv('USERPROFILE', join(root, 'home'))
  vi.stubEnv('ORCA_E2E_USER_DATA_DIR', '')
  vi.stubEnv('ORCA_E2E_HOME_DIR', '')
  options = {
    isPackaged: true,
    userDataPath: fixture.userData,
    selectedCodexHomePath: null,
    agentStatusHooksEnabled: false
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('the environment of a Droid terminal', () => {
  it('turns the keychain off for a Droid launch in an isolated profile', () => {
    vi.stubEnv('ORCA_E2E_HOME_DIR', join(root, 'e2e-home'))

    const env = buildPtyHostEnv('droid-pane', {}, { ...options, launchAgent: 'droid' })

    expect(env.FACTORY_DISABLE_KEYRING).toBe('1')
  })

  it('also covers a Droid typed as the launch command', () => {
    vi.stubEnv('ORCA_E2E_USER_DATA_DIR', join(root, 'e2e-data'))

    const env = buildPtyHostEnv('droid-pane', {}, { ...options, launchCommand: 'droid' })

    expect(env.FACTORY_DISABLE_KEYRING).toBe('1')
  })

  it('leaves a real profile and every other terminal alone', () => {
    expect(
      buildPtyHostEnv('real-profile', {}, { ...options, launchAgent: 'droid' })
    ).not.toHaveProperty('FACTORY_DISABLE_KEYRING')

    vi.stubEnv('ORCA_E2E_HOME_DIR', join(root, 'e2e-home'))
    expect(buildPtyHostEnv('bare-shell', {}, options)).not.toHaveProperty('FACTORY_DISABLE_KEYRING')
  })
})
