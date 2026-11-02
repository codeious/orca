import '../unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AGENT_SESSION_SESSION_OPTIONS_CAPABILITY } from '../../../../shared/agent-session/options/agent-session-session-options'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  SESSION,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'

beforeEach(installStructuredHostStub)
afterEach(clearStructuredHostStub)
it('returns session-only descriptors only to a negotiated reader', async () => {
  const sessionOptions = [
    {
      id: 'session-level',
      scope: 'session',
      label: 'Level',
      kind: { type: 'select', currentValue: 'low', choices: [{ value: 'low', label: 'Low' }] },
      transport: 'agent-session',
      valueSource: 'reported',
      settable: true
    }
  ]
  hostCalls.readOptions!.mockResolvedValue({ models: [], current: {}, sessionOptions })
  const old = await call('agentSession.options', { sessionId: SESSION }, STRUCTURED_CLIENT)
  expect(old).toMatchObject({ ok: true })
  if (old.ok) {
    expect(old.result).not.toHaveProperty('sessionOptions')
  }
  const current = await call(
    'agentSession.options',
    { sessionId: SESSION },
    {
      ...STRUCTURED_CLIENT,
      clientCapabilities: [
        ...STRUCTURED_CLIENT.clientCapabilities,
        AGENT_SESSION_SESSION_OPTIONS_CAPABILITY
      ]
    }
  )
  expect(current).toMatchObject({ ok: true, result: { sessionOptions } })
})
