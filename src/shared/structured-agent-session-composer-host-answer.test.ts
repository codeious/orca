import { describe, expect, it, vi } from 'vitest'
import { dispatchStructuredAgentSessionComposerCommand } from './structured-agent-session-composer'

const base = {
  snapshot: [],
  invokeAction: async () => true,
  setOption: async () => true,
  conversationCommands: ['clear', 'compact'] as const,
  runConversationCommand: vi.fn(async () => ({ accepted: true, error: null }))
}

describe('a host-answered command', () => {
  it('shows the answer in place of the refusal and never reaches the model', async () => {
    const answerHostCommand = vi.fn((name: string) => (name === 'help' ? 'the key list' : null))
    const outcome = await dispatchStructuredAgentSessionComposerCommand('/help', {
      ...base,
      agent: 'droid',
      answerHostCommand
    })
    expect(outcome).toEqual({ handled: true, accepted: true, error: 'the key list' })
    expect(answerHostCommand).toHaveBeenCalledWith('help')
    expect(base.runConversationCommand).not.toHaveBeenCalled()
  })

  it('answers the command whatever follows it', async () => {
    const outcome = await dispatchStructuredAgentSessionComposerCommand('/HELP  me', {
      ...base,
      agent: 'droid',
      answerHostCommand: (name) => (name === 'help' ? 'the key list' : null)
    })
    expect(outcome).toMatchObject({ handled: true, error: 'the key list' })
  })

  it('keeps the refusal for a command the answer does not cover', async () => {
    const outcome = await dispatchStructuredAgentSessionComposerCommand('/help', {
      ...base,
      agent: 'droid',
      answerHostCommand: () => null
    })
    expect(outcome.error).toMatch(/\/help is not available in chat sessions/)
  })

  it("keeps today's refusal when no answer is supplied", async () => {
    const outcome = await dispatchStructuredAgentSessionComposerCommand('/help', {
      ...base,
      agent: 'droid'
    })
    expect(outcome.handled).toBe(true)
    expect(outcome.error).toMatch(/\/help is not available in chat sessions/)
  })

  // Claude's harness runs /help itself and Codex does not list it: neither is the host's to answer.
  it.each(['claude', 'codex'])('does not touch /help for %s', async (agent) => {
    const answerHostCommand = vi.fn(() => 'the key list')
    const outcome = await dispatchStructuredAgentSessionComposerCommand('/help', {
      ...base,
      agent,
      answerHostCommand
    })
    expect(outcome).toEqual({ handled: false, accepted: false, error: null })
    expect(answerHostCommand).not.toHaveBeenCalled()
  })

  it('leaves the commands the host already ran to their own path', async () => {
    const answerHostCommand = vi.fn(() => 'the key list')
    const outcome = await dispatchStructuredAgentSessionComposerCommand('/clear', {
      ...base,
      agent: 'droid',
      answerHostCommand
    })
    expect(outcome).toMatchObject({ handled: true, accepted: true })
    expect(base.runConversationCommand).toHaveBeenCalledWith('clear')
    expect(answerHostCommand).not.toHaveBeenCalled()
  })
})
