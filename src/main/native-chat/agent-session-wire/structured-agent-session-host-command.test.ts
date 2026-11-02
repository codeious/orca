import { describe, expect, it, vi } from 'vitest'
import {
  attach,
  CALLER,
  envelope,
  hostTestState,
  seedApproval
} from './structured-agent-session-host-test-harness'

describe('provider host commands', () => {
  it('forwards sign-in ephemerally to its initiating reader without journaling or replaying the URL', async () => {
    const { host } = hostTestState()
    const link = 'https://auth.example.invalid/?state=not-in-journal'
    const identity = { callerKey: CALLER.callerKey, connectionId: 'connection' }
    const fields = { name: 'mcp', argument: 'sign-in sample' }
    const params = { ...fields, envelope: envelope('agentSession.hostCommand', fields) }
    host.deps.adapter.readCommands = () => [{ name: 'mcp', kind: 'command', hostCommand: true }]
    const run = vi.fn<NonNullable<typeof host.deps.adapter.hostCommand>>(async (input) => {
      expect(await input.openMcpSignIn?.(link)).toBe(true)
      return { text: 'sample: signed-in' }
    })
    host.deps.adapter.hostCommand = run
    await attach()
    const transient = vi.fn()
    const dispose = await host.subscribe({
      id: 'reader',
      sessionId: params.envelope.sessionId,
      mcpSignInCaller: identity,
      emit: (event) => {
        if (event.type === 'batch' && event.mcpSignInOpen) {
          transient(event.mcpSignInOpen.url)
          host.mcpSignIn.acknowledge(
            event.sessionId,
            event.mcpSignInOpen.requestId,
            identity.connectionId,
            identity.callerKey,
            true
          )
        }
      }
    })
    const caller = { ...CALLER, mcpSignInCaller: identity }
    expect(await host.hostCommand(caller, params)).toMatchObject({ ok: true })
    expect(await host.hostCommand(caller, params)).toMatchObject({ ok: true, replayed: true })
    expect(run).toHaveBeenCalledOnce()
    expect(transient).toHaveBeenCalledExactlyOnceWith(link)
    expect(JSON.stringify(await host.journalSnapshot(params.envelope.sessionId))).not.toContain(
      link
    )
    dispose()
  })

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
