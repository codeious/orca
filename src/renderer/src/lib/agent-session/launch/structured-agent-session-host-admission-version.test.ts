import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSupport = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: createSupport
}))

import { askHostCreateSupport } from './structured-agent-session-host-admission'

const version = {
  agent: 'codex',
  installedVersion: '0.1.0',
  minimumVersion: '0.2.0'
}

beforeEach(() => createSupport.mockReset())

describe('host admission version facts', () => {
  it('retains the host reason alongside supported version facts', async () => {
    createSupport.mockResolvedValue({
      supported: false,
      reason: 'agent',
      agentInstallation: version
    })
    await expect(askHostCreateSupport({ kind: 'local' }, 'workspace', 'codex')).resolves.toEqual({
      kind: 'declined',
      reason: 'agent',
      agentInstallation: version
    })
  })

  it.each([undefined, { found: '0.1.0' }])(
    'does not invent facts from older or malformed host responses: %s',
    async (agentInstallation) => {
      createSupport.mockResolvedValue({ supported: false, reason: 'agent', agentInstallation })
      await expect(askHostCreateSupport({ kind: 'local' }, 'workspace', 'codex')).resolves.toEqual({
        kind: 'declined',
        reason: 'agent'
      })
    }
  )

  it('keeps unrelated upstream refusal reasons without version facts', async () => {
    createSupport.mockResolvedValue({
      supported: false,
      reason: 'chat-program',
      agentInstallation: version
    })
    await expect(askHostCreateSupport({ kind: 'local' }, 'workspace', 'codex')).resolves.toEqual({
      kind: 'declined',
      reason: 'chat-program'
    })
  })
})
