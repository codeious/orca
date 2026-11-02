import '../unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_SESSION_HOST_COMMAND_CAPABILITY } from '../../../../shared/agent-session/agent-session-host-command'
import {
  call,
  clearStructuredHostStub,
  envelope,
  installStructuredHostStub,
  SESSION,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'
import { projectHostCommandCatalog } from './structured-agent-session-host-command'

afterEach(clearStructuredHostStub)

describe('host command compatibility', () => {
  it('rejects calls from a structured client without the new capability', async () => {
    installStructuredHostStub()
    const result = await call(
      'agentSession.hostCommand',
      {
        envelope: envelope(),
        name: 'context',
        argument: ''
      },
      STRUCTURED_CLIENT
    )
    expect(result).toMatchObject({
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

  it('withholds marked commands in catalogs, history pages and initial attach replies', () => {
    const commands = [
      { name: 'context', kind: 'command', hostCommand: true },
      { name: 'review', kind: 'command' }
    ]
    const old = { clientKind: 'runtime' as const, clientCapabilities: [] }
    const current = {
      clientKind: 'runtime' as const,
      clientCapabilities: [AGENT_SESSION_HOST_COMMAND_CAPABILITY]
    }
    const value = { value: { page: { sessionId: SESSION, commands } } }
    expect(projectHostCommandCatalog(value, old).value.page.commands).toEqual([commands[1]])
    expect(projectHostCommandCatalog({ commands }, old).commands).toEqual([commands[1]])
    expect(projectHostCommandCatalog(value, current)).toBe(value)
  })
})
