import '../../../unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub
} from '../protocol/structured-agent-session-rpc.test-fixture'
import {
  envelope,
  SESSION,
  STRUCTURED_CLIENT
} from '../protocol/structured-agent-session-rpc-client.test-fixture'

afterEach(clearStructuredHostStub)

describe('host command compatibility', () => {
  it('rejects calls from a structured client without the host-command capability', async () => {
    installStructuredHostStub()
    expect(
      await call(
        'agentSession.hostCommand',
        { envelope: envelope(), name: 'context', argument: '' },
        STRUCTURED_CLIENT
      )
    ).toMatchObject({
      ok: false,
      error: {
        code: 'runtime_error',
        data: {
          refusal: {
            code: 'structured_agent_session_unsupported',
            details: { reason: 'clientCapabilityMissing' }
          }
        }
      }
    })
  })

  it('withholds marked catalogs from old clients while offering them to capable clients', async () => {
    installStructuredHostStub()
    const commands = [
      { name: 'context', kind: 'command', hostCommand: true },
      { name: 'review', kind: 'command' }
    ]
    hostCalls.readCommands = vi.fn(() => ({ commands }))
    hostCalls.history?.mockReturnValue({ ok: true, page: { commands, items: [] } })
    expect(
      await call('agentSession.commands', { sessionId: SESSION }, STRUCTURED_CLIENT)
    ).toMatchObject({
      ok: true,
      result: { commands: [{ name: 'review', kind: 'command' }] }
    })
    expect(
      await call(
        'agentSession.history',
        { sessionId: SESSION, direction: 'tail' },
        STRUCTURED_CLIENT
      )
    ).toMatchObject({
      ok: true,
      result: { ok: true, page: { commands: [{ name: 'review', kind: 'command' }] } }
    })
    expect(
      await call(
        'agentSession.commands',
        { sessionId: SESSION },
        {
          ...STRUCTURED_CLIENT,
          clientCapabilities: [
            ...STRUCTURED_CLIENT.clientCapabilities,
            'agent-session.host-command.v1'
          ]
        }
      )
    ).toMatchObject({
      ok: true,
      result: {
        commands: [
          { name: 'context', kind: 'command', hostCommand: true },
          { name: 'review', kind: 'command' }
        ]
      }
    })
  })
})
