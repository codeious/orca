import { describe, expect, it, vi } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { isStructuredAdoptionAgent } from '../../../../shared/structured-adoption-agent'
import { ALL_TUI_AGENTS } from '../../../../shared/tui-agent-display-names'
import { STRUCTURED_AGENT_RUNTIME_REGISTRATIONS } from '../../structured-agent-runtime-registrations'
import type { RpcContext } from '../core'
import { STRUCTURED_AGENT_SESSION_AGENTS_METHODS } from './structured-agent-session-agents'

const [method] = STRUCTURED_AGENT_SESSION_AGENTS_METHODS

const ensureStructuredAgentSessionHost = vi.fn(async () => {
  throw new Error('the journal would not open')
})

function context(overrides: Partial<RpcContext>): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only the caller's capabilities; the runtime stub proves it never installs the host.
  return { runtime: { ensureStructuredAgentSessionHost }, ...overrides } as unknown as RpcContext
}

describe('agentSession.agents', () => {
  it("lists this build's registered agents without installing the host", async () => {
    const ctx = context({})

    const result = await method.handler({}, ctx)

    expect(result.agents.map(({ agent }) => agent)).toEqual(
      STRUCTURED_AGENT_RUNTIME_REGISTRATIONS.map(({ definition }) => definition.agent)
    )
    expect(result.agents.map(({ agent }) => agent)).toContain('opencode')
    expect(ensureStructuredAgentSessionHost).not.toHaveBeenCalled()
  })

  // The desktop offers "Resume in new chat" for these without waiting for this list.
  it('lists every agent a conversation can be resumed into a chat for', async () => {
    const adopted = ALL_TUI_AGENTS.filter(isStructuredAdoptionAgent)

    const result = await method.handler({}, context({}))

    expect(adopted).toContain('droid')
    expect(result.agents.map(({ agent }) => agent)).toEqual(expect.arrayContaining(adopted))
  })

  it('still refuses a remote client that cannot read structured sessions', async () => {
    await expect(
      method.handler({}, context({ clientKind: 'mobile', clientCapabilities: [] }))
    ).rejects.toMatchObject({ refusal: { code: 'structured_agent_session_unsupported' } })
    await expect(
      method.handler(
        {},
        context({
          clientKind: 'mobile',
          clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
        })
      )
    ).resolves.toMatchObject({ agents: expect.any(Array) })
  })
})
