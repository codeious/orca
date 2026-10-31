import { describe, expect, it, vi } from 'vitest'
import type { DroidHostCommand, DroidHostCommandResult } from '../../../shared/droid-host-command'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import { runStructuredAgentSessionDroidCommand } from './structured-agent-session-droid-command'
import { createStructuredAgentSessionLogger } from './structured-agent-session-logger'

const SESSION = 'session-1'
const CHILD = { generation: 'generation-1', fence: 7, phase: 'ready' } as const
const RESULT: DroidHostCommandResult = { name: 'credits', factoryCredits: 3 }

function rig(options: { child?: boolean; attached?: boolean; adapter?: boolean } = {}) {
  const { child = true, attached = true, adapter = true } = options
  let held = false
  const log: string[] = []
  const droidCommand = vi.fn(async (_input: Parameters<StructuredAgentSessionDroidCommand>[0]) => {
    log.push(
      held ? 'adapter ran inside the session queue' : 'adapter ran outside the session queue'
    )
    return RESULT
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the command path reads only `child` from the session.
  const session = { child: child ? { ...CHILD } : null } as StructuredAgentSessionHostSession
  const ensureAgent = vi.fn(async () => {
    session.child = { ...CHILD }
    return { ok: true as const }
  })
  const context = {
    deps: {
      logger: createStructuredAgentSessionLogger(),
      adapter: adapter ? { droidCommand } : {}
    },
    serialize: async <T>(_sessionId: string, task: () => Promise<T>) => {
      held = true
      try {
        return await task()
      } finally {
        held = false
      }
    },
    openConversation: vi.fn(async () => (attached ? session : null)),
    ensureAgent
  }
  const run = (command: DroidHostCommand) =>
    runStructuredAgentSessionDroidCommand(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the command path reads only the members this double provides.
      context as unknown as Parameters<typeof runStructuredAgentSessionDroidCommand>[0],
      SESSION,
      command
    )
  return { run, droidCommand, ensureAgent, log }
}

type StructuredAgentSessionDroidCommand = NonNullable<StructuredAgentSessionAdapter['droidCommand']>

describe('a Droid chat command on the host', () => {
  it('runs on the live child under the fence it holds and answers with the child result', async () => {
    const { run, droidCommand } = rig()

    expect(await run({ name: 'context' })).toEqual(RESULT)
    expect(droidCommand).toHaveBeenCalledWith({
      sessionId: SESSION,
      fence: 7,
      command: { name: 'context' }
    })
  })

  it('leaves the session queue before it asks the child, which may take a long while', async () => {
    const { run, log } = rig()

    await run({ name: 'compress', instructions: 'keep the schema' })

    expect(log).toEqual(['adapter ran outside the session queue'])
  })

  it.each<DroidHostCommand>([{ name: 'context' }, { name: 'compress' }])(
    'starts the agent at rest for /$name',
    async (command) => {
      const { run, ensureAgent, droidCommand } = rig({ child: false })

      await run(command)

      expect(ensureAgent).toHaveBeenCalledWith(SESSION)
      expect(droidCommand).toHaveBeenCalledWith(expect.objectContaining({ fence: 7 }))
    }
  )

  it('starts nothing to read credits an agent at rest no longer holds', async () => {
    const { run, ensureAgent, droidCommand } = rig({ child: false })

    expect(await run({ name: 'credits' })).toEqual({ name: 'credits', factoryCredits: null })
    expect(ensureAgent).not.toHaveBeenCalled()
    expect(droidCommand).not.toHaveBeenCalled()
  })

  it('refuses a session this host holds no conversation for', async () => {
    const { run, droidCommand } = rig({ attached: false })

    await expect(run({ name: 'context' })).rejects.toThrow('agent_session_ownership_unknown')
    expect(droidCommand).not.toHaveBeenCalled()
  })

  it('says so when the agent behind the chat has no Droid commands', async () => {
    const { run } = rig({ adapter: false })

    await expect(run({ name: 'context' })).rejects.toThrow(
      'Droid commands are unavailable for this chat.'
    )
  })

  it('passes the child refusal on as it was worded', async () => {
    const { run, droidCommand } = rig()
    droidCommand.mockRejectedValueOnce(
      new Error('Compacting the conversation needs a newer Droid. Update Droid and try again.')
    )

    await expect(run({ name: 'compress' })).rejects.toThrow(
      'Compacting the conversation needs a newer Droid. Update Droid and try again.'
    )
  })
})
