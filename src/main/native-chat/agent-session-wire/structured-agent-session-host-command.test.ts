import { describe, expect, it, vi } from 'vitest'
import {
  attach,
  CALLER,
  envelope,
  hostTestState,
  seedApproval
} from './structured-agent-session-host-test-harness'

describe('provider host commands', () => {
  it('executes once, replays the same reply, and never submits a model message', async () => {
    const { host, dispatch } = hostTestState()
    const run = vi.fn(async () => ({ text: 'Context report' }))
    host.deps.adapter.readCommands = () => [{ name: 'context', kind: 'command', hostCommand: true }]
    host.deps.adapter.hostCommand = run
    await attach()
    const fields = { name: 'context', argument: '' }
    const params = { ...fields, envelope: envelope('agentSession.hostCommand', fields) }
    expect(await host.hostCommand(CALLER, params)).toMatchObject({
      ok: true,
      value: { text: 'Context report' }
    })
    expect(await host.hostCommand(CALLER, params)).toMatchObject({ ok: true, replayed: true })
    expect(run).toHaveBeenCalledOnce()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses unreported commands and commands behind an unanswered prompt', async () => {
    const { host } = hostTestState()
    const run = vi.fn(async () => ({ text: 'No' }))
    host.deps.adapter.readCommands = () => [{ name: 'context', kind: 'command', hostCommand: true }]
    host.deps.adapter.hostCommand = run
    await attach()
    const unknown = { name: 'unknown', argument: '' }
    expect(
      await host.hostCommand(CALLER, {
        ...unknown,
        envelope: envelope('agentSession.hostCommand', unknown)
      })
    ).toMatchObject({ ok: false })
    await seedApproval()
    const fields = { name: 'context', argument: '' }
    expect(
      await host.hostCommand(CALLER, {
        ...fields,
        envelope: envelope('agentSession.hostCommand', fields)
      })
    ).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('copies once without replacing the source conversation', async () => {
    const { host, store } = hostTestState()
    const copy = vi.fn(async () => ({ sessionId: 'fork-session' }))
    host.deps.adapter.copyConversation = copy
    await attach()
    const params = { envelope: envelope('agentSession.copyConversation', {}) }
    const before = store.getRecord(params.envelope.sessionId)?.providerHandleChain
    expect(await host.copyConversation(CALLER, params)).toMatchObject({
      ok: true,
      value: { providerSessionId: 'fork-session' }
    })
    expect(await host.copyConversation(CALLER, params)).toMatchObject({ ok: true, replayed: true })
    expect(copy).toHaveBeenCalledOnce()
    expect(store.getRecord(params.envelope.sessionId)?.providerHandleChain).toEqual(before)
  })
})
