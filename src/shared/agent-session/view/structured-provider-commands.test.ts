import { expect, it, vi } from 'vitest'
import { dispatchStructuredAgentSessionComposerCommand } from './structured-agent-session-composer'

it('routes marked provider commands to the host, leaving unmarked text for the agent', async () => {
  const runHostCommand = vi.fn(async () => ({ accepted: true, error: null }))
  const controller = {
    agent: 'codex',
    snapshot: [],
    invokeAction: async () => true,
    setOption: async () => true,
    runHostCommand
  }
  expect(
    await dispatchStructuredAgentSessionComposerCommand('/context verbose', {
      ...controller,
      sessionCommands: [{ name: 'context', kind: 'command', hostCommand: true }]
    })
  ).toEqual({ handled: true, accepted: true, error: null })
  expect(runHostCommand).toHaveBeenCalledWith('context', 'verbose')
  expect(
    await dispatchStructuredAgentSessionComposerCommand('/context verbose', {
      ...controller,
      sessionCommands: [{ name: 'context', kind: 'command' }]
    })
  ).toEqual({ handled: false, accepted: false, error: null })
})
