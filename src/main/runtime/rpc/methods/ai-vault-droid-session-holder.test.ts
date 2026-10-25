import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { AI_VAULT_METHODS } from './ai-vault'

function request(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'aiVault.droidSessionHolder', params }
}

function dispatcherFor(droidSessionHolder: (sessionId: string) => Promise<unknown>) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only these runtime members.
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    droidSessionHolder
  } as unknown as OrcaRuntimeService
  return new RpcDispatcher({ runtime, methods: AI_VAULT_METHODS })
}

describe('aiVault.droidSessionHolder', () => {
  it.each(['live', 'unverifiable', null] as const)(
    'answers %s from the host that owns the process',
    async (holder) => {
      const droidSessionHolder = vi.fn(async () => holder)

      const response = await dispatcherFor(droidSessionHolder).dispatch(
        request({ sessionId: 'droid-session' })
      )

      expect(response).toMatchObject({ ok: true, result: { holder } })
      expect(droidSessionHolder).toHaveBeenCalledWith('droid-session')
    }
  )

  it.each([
    ['no session id', {}],
    ['an empty session id', { sessionId: '' }],
    ['an unbounded session id', { sessionId: 'x'.repeat(513) }],
    ['a non-string session id', { sessionId: 7 }]
  ])('refuses %s before asking the host', async (_label, params) => {
    const droidSessionHolder = vi.fn(async () => null)

    const response = await dispatcherFor(droidSessionHolder).dispatch(request(params))

    expect(response).toMatchObject({ ok: false })
    expect(droidSessionHolder).not.toHaveBeenCalled()
  })

  // It reports a terminal process, not a chat, so a host whose chats are refused still answers.
  it('does not need a structured chat host to answer', async () => {
    const ensureStructuredAgentSessionHost = vi.fn(async () => {
      throw new Error('chats are refused here')
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only these runtime members.
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      ensureStructuredAgentSessionHost,
      droidSessionHolder: async () => 'live' as const
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: AI_VAULT_METHODS })

    const response = await dispatcher.dispatch(request({ sessionId: 'droid-session' }))

    expect(response).toMatchObject({ ok: true, result: { holder: 'live' } })
    expect(ensureStructuredAgentSessionHost).not.toHaveBeenCalled()
  })
})
