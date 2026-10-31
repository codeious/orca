import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  SESSION,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'

beforeEach(() => {
  installStructuredHostStub()
  // The shared stub is at its line limit; this method is the only one that reads this call.
  hostCalls.droidCommand = vi.fn(async () => ({ name: 'credits', factoryCredits: null }))
})

afterEach(() => {
  clearStructuredHostStub()
})

describe('agentSession.droidCommand', () => {
  it.each([
    [{ name: 'context' }],
    [{ name: 'credits' }],
    [{ name: 'compress' }],
    [{ name: 'compress', instructions: 'keep the schema' }],
    [{ name: 'fork' }],
    [{ name: 'rewind', itemId: 'droid:message-1' }]
  ])('hands %j to the host for the session and answers with its result', async (command) => {
    hostCalls.droidCommand.mockResolvedValueOnce({ name: 'credits', factoryCredits: 12 })

    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command },
      STRUCTURED_CLIENT
    )

    expect(hostCalls.droidCommand).toHaveBeenCalledWith(SESSION, command)
    expect(response).toMatchObject({ ok: true, result: { name: 'credits', factoryCredits: 12 } })
  })

  it.each([
    ['a command Droid chat does not have', { name: 'cost' }],
    ['a key it does not know', { name: 'context', verbose: true }],
    ['instructions on a command that takes none', { name: 'credits', instructions: 'x' }],
    ['an empty command', {}],
    ['a title for the fork, which the host words itself', { name: 'fork', title: 'x' }],
    ['a rewind that names no row', { name: 'rewind' }],
    ['a rewind to an empty row id', { name: 'rewind', itemId: '' }],
    ['a rewind that names the Droid message itself', { name: 'rewind', messageId: 'droid-1' }]
  ])('refuses %s before reaching the host', async (_label, command) => {
    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command },
      STRUCTURED_CLIENT
    )

    expect(response).toMatchObject({ ok: false })
    expect(hostCalls.droidCommand).not.toHaveBeenCalled()
  })

  it('refuses a key beside the session and command', async () => {
    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command: { name: 'context' }, fence: 3 },
      STRUCTURED_CLIENT
    )

    expect(response).toMatchObject({ ok: false })
    expect(hostCalls.droidCommand).not.toHaveBeenCalled()
  })

  it('refuses a client that never negotiated structured sessions', async () => {
    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command: { name: 'context' } },
      { clientKind: 'runtime', clientCapabilities: [] }
    )

    expect(response).toMatchObject({ ok: false })
    expect(hostCalls.droidCommand).not.toHaveBeenCalled()
  })
})
