import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import type { StructuredAgentRuntimeRegistration } from './structured-agent-runtime-registrations'
import { resolveHostStructuredAgentCreateSupport } from './structured-agent-launch-support'

const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, Partial<StructuredAgentRuntimeRegistration>>()
}))
vi.mock('./structured-agent-runtime-registrations', () => ({
  structuredAgentRuntimeRegistration: (agent: string) => registrations.get(agent) ?? null
}))
vi.mock('./structured-agent-shell-environment', () => ({
  resolveHostAgentBaseEnvironment: async () => ({ PATH: '/host/bin' })
}))

const local: AgentSessionExecutionLocation = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'git-worktree'
}
const settings = {
  nativeChatInheritShellEnvironment: true,
  nativeChatShellEnvironmentVariables: [],
  agentDefaultEnv: {}
}
const runtime = {
  requireStore: () => ({ getSettings: () => settings }),
  resolveRuntimeFileTarget: async () => ({ worktree: { path: '/work' } })
}
const old = {
  agentName: 'Droid',
  found: '0.230.0',
  floor: '0.238.0',
  updateCommand: 'droid update'
}

function support(location = local) {
  return resolveHostStructuredAgentCreateSupport({
    agent: 'droid',
    worktreeSelector: 'id:workspace-1',
    location,
    runtime
  })
}

beforeEach(() => {
  registrations.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the installed release behind a refused launch check', () => {
  it('is named when the agent says its age alone is why', async () => {
    const unsupportedVersion = vi.fn(async () => old)
    registrations.set('droid', {
      supportsLocation: () => true,
      supportsLaunch: async () => false,
      unsupportedVersion
    })

    await expect(support()).resolves.toEqual({
      supported: false,
      reason: 'agent',
      unsupportedVersion: old
    })
    expect(unsupportedVersion).toHaveBeenCalledWith({
      cwd: '/work',
      env: expect.objectContaining({ PATH: '/host/bin' }),
      commandSettings: settings
    })
  })

  it('is not asked after a launch check that passed', async () => {
    const unsupportedVersion = vi.fn(async () => old)
    registrations.set('droid', {
      supportsLocation: () => true,
      supportsLaunch: async () => true,
      unsupportedVersion
    })

    await expect(support()).resolves.toEqual({ supported: true })
    expect(unsupportedVersion).not.toHaveBeenCalled()
  })

  it('is not asked where the location already refuses', async () => {
    const unsupportedVersion = vi.fn(async () => old)
    registrations.set('droid', {
      supportsLocation: () => false,
      supportsLaunch: async () => false,
      unsupportedVersion
    })

    await expect(support({ ...local, executionHostId: 'ssh:box' })).resolves.toEqual({
      supported: false,
      reason: 'remote'
    })
    expect(unsupportedVersion).not.toHaveBeenCalled()
  })

  it.each([
    ['says it is not the age', async () => null],
    ['has no such check', undefined]
  ])('names no release when the agent %s', async (_name, unsupportedVersion) => {
    registrations.set('droid', {
      supportsLocation: () => true,
      supportsLaunch: async () => false,
      ...(unsupportedVersion ? { unsupportedVersion } : {})
    })

    await expect(support()).resolves.toEqual({ supported: false, reason: 'agent' })
  })
})
