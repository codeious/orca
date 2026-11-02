import { describe, expect, it, vi } from 'vitest'
import {
  dispatchStructuredAgentSessionComposerCommand,
  isStructuredAgentSessionComposerCommand,
  structuredSessionSlashCommands
} from './structured-agent-session-composer'

const base = {
  agent: 'droid',
  snapshot: [],
  invokeAction: async () => true,
  setOption: async () => true
}
const sessionCommands = [{ name: 'context', kind: 'command', hostCommand: true }] as const

describe('reported provider commands', () => {
  it('runs only marked provider commands through the host transport', async () => {
    const runHostCommand = vi.fn(async () => ({ accepted: true, error: null }))
    expect(
      await dispatchStructuredAgentSessionComposerCommand('/context', {
        ...base,
        sessionCommands,
        runHostCommand
      })
    ).toEqual({ handled: true, accepted: true, error: null })
    expect(runHostCommand).toHaveBeenCalledWith('context', '')
    expect(isStructuredAgentSessionComposerCommand('/context', 'droid', sessionCommands)).toBe(true)
    expect(
      await dispatchStructuredAgentSessionComposerCommand('/context', { ...base, runHostCommand })
    ).toMatchObject({ handled: false })
  })

  it('routes aliases and session actions through their generic operations', async () => {
    const runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))
    const runSessionAction = vi.fn(async () => ({ accepted: true, error: null }))
    const controller = {
      ...base,
      conversationCommands: ['clear', 'compact'] as const,
      runConversationCommand,
      runSessionAction
    }
    await dispatchStructuredAgentSessionComposerCommand('/new', controller)
    await dispatchStructuredAgentSessionComposerCommand('/compress', controller)
    await dispatchStructuredAgentSessionComposerCommand('/rename A chat', controller)
    await dispatchStructuredAgentSessionComposerCommand('/fork', controller)
    expect(runConversationCommand.mock.calls).toEqual([['clear'], ['compact']])
    expect(runSessionAction.mock.calls).toEqual([
      ['rename', 'A chat'],
      ['fork', '']
    ])
    const mobile = structuredSessionSlashCommands(
      'droid',
      ['clear', 'compact'],
      sessionCommands,
      false
    )
    expect(mobile.map(({ name }) => name)).toContain('context')
    expect(mobile.map(({ name }) => name)).not.toContain('fork')
    expect(mobile.map(({ name }) => name)).not.toContain('rename')
  })
})
