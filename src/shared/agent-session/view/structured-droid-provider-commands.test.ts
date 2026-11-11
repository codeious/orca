import { expect, it } from 'vitest'
import { dispatchStructuredAgentSessionComposerCommand } from './structured-agent-session-composer'

it('routes conversation aliases and session actions without sending model text', async () => {
  const operations: unknown[] = []
  const controller = {
    agent: 'droid',
    snapshot: [],
    invokeAction: async () => false,
    setOption: async () => false,
    conversationCommands: ['clear', 'compact'] as const,
    runConversationCommand: async (command: string) => {
      operations.push([command])
      return { accepted: true, error: null }
    },
    runSessionAction: async (name: string, argument: string) => {
      operations.push([name, argument])
      return { accepted: true, error: null }
    }
  }
  await dispatchStructuredAgentSessionComposerCommand('/new', controller)
  await dispatchStructuredAgentSessionComposerCommand('/compress', controller)
  await dispatchStructuredAgentSessionComposerCommand('/rename A chat', controller)
  await dispatchStructuredAgentSessionComposerCommand('/fork', controller)
  expect(operations).toEqual([['clear'], ['compact'], ['rename', 'A chat'], ['fork', '']])
})
