import { describe, expect, it } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { resolveStructuredAgentSessionCreateSupport } from './structured-agent-session-create-support'

const LOCAL: AgentSessionExecutionLocation = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'git-worktree'
}

describe('resolveStructuredAgentSessionCreateSupport', () => {
  it('supports what the adapter supports', () => {
    expect(
      resolveStructuredAgentSessionCreateSupport({ location: LOCAL, adapterSupportsCreate: true })
    ).toEqual({ supported: true })
  })

  it('keeps the agent reason and adds the release when only its version refused', () => {
    const unsupportedVersion = {
      agentName: 'Droid',
      found: '0.230.0',
      floor: '0.238.0',
      updateCommand: 'droid update'
    }
    expect(
      resolveStructuredAgentSessionCreateSupport({
        location: LOCAL,
        adapterSupportsCreate: false,
        unsupportedVersion
      })
    ).toEqual({ supported: false, reason: 'agent', unsupportedVersion })
  })

  it('names no release for a location that refused', () => {
    const unsupportedVersion = {
      agentName: 'Droid',
      found: '0.230.0',
      floor: '0.238.0',
      updateCommand: 'droid update'
    }
    expect(
      resolveStructuredAgentSessionCreateSupport({
        location: { ...LOCAL, wslDistro: 'Ubuntu' },
        adapterSupportsCreate: false,
        unsupportedVersion
      })
    ).toEqual({ supported: false, reason: 'wsl' })
  })

  it.each([
    ['remote', { ...LOCAL, executionHostId: 'ssh:host-a' }, 'remote'],
    ['wsl workspace', { ...LOCAL, wslDistro: 'Ubuntu' }, 'wsl'],
    ['unsupported agent', LOCAL, 'agent']
  ] as const)('keeps the adapter refusal reason for %s', (_name, location, reason) => {
    expect(
      resolveStructuredAgentSessionCreateSupport({ location, adapterSupportsCreate: false })
    ).toEqual({ supported: false, reason })
  })
})
