import { describe, expect, it, vi } from 'vitest'
import {
  agentJournalItemKey,
  agentJournalSubmissionKey
} from '../../../shared/agent-session-journal-item-key'
import type {
  DroidHostCommandRequest,
  DroidHostCommandResult
} from '../../../shared/droid-host-command'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import {
  bindMcpSignInCaller,
  runStructuredAgentSessionDroidCommand
} from './structured-agent-session-droid-command'
import { AgentSessionMcpSignInForwarding } from './agent-session-mcp-sign-in-forwarding'
import { createStructuredAgentSessionLogger } from './structured-agent-session-logger'

const SESSION = 'session-1'
const CHILD = { generation: 'generation-1', fence: 7, phase: 'ready' } as const
const RESULT: DroidHostCommandResult = { name: 'credits', factoryCredits: 3 }
const DROID_ROW = agentJournalItemKey({ provider: 'droid', messageId: 'droid-message-1' })
const SEND_ROW = agentJournalSubmissionKey('client-1')
const OTHER_ROW = agentJournalItemKey({ provider: 'claude', sessionId: 's', uuid: 'u' })

function rig(
  options: { child?: boolean; attached?: boolean; adapter?: boolean; starts?: boolean } = {}
) {
  const { child = true, attached = true, adapter = true, starts = true } = options
  let held = false
  const log: string[] = []
  const droidCommand = vi.fn(async (_input: Parameters<StructuredAgentSessionDroidCommand>[0]) => {
    log.push(
      held ? 'adapter ran inside the session queue' : 'adapter ran outside the session queue'
    )
    return RESULT
  })
  const journal = {
    snapshot: () => ({
      items: [DROID_ROW, SEND_ROW, OTHER_ROW].map((itemId) => ({ itemId })),
      submissions: [
        {
          clientMessageId: 'client-1',
          dispatchState: 'accepted' as const,
          providerItemId: agentJournalItemKey({ provider: 'droid', messageId: 'droid-message-2' })
        }
      ]
    })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the command path reads only `child` and the journal's snapshot from the session.
  const session = {
    child: child ? { ...CHILD } : null,
    journal
  } as unknown as StructuredAgentSessionHostSession
  const ensureAgent = vi.fn(async () => {
    session.child = starts ? { ...CHILD } : null
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
  const run = (command: DroidHostCommandRequest) =>
    runStructuredAgentSessionDroidCommand(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the command path reads only the members this double provides.
      context as unknown as Parameters<typeof runStructuredAgentSessionDroidCommand>[0],
      SESSION,
      command
    )
  return { run, droidCommand, ensureAgent, log }
}

type StructuredAgentSessionDroidCommand = NonNullable<StructuredAgentSessionAdapter['droidCommand']>

describe('the MCP sign-in caller command binding', () => {
  const caller = { callerKey: 'desktop', connectionId: 'connection' }
  const signIn = { name: 'mcp', action: { kind: 'sign-in', serverName: 'intended' } } as const

  it.each([undefined, caller])(
    'guards a sign-in even when its first caller is %s',
    async (firstCaller) => {
      const forwarding = new AgentSessionMcpSignInForwarding()
      const send = vi.fn()
      forwarding.subscribe('reader', { ...caller, sessionId: SESSION, send })
      let finish = () => {}
      const runCommand = vi.fn(
        () =>
          new Promise<DroidHostCommandResult>((resolve) => {
            finish = () => resolve(RESULT)
          })
      )
      const run = bindMcpSignInCaller(forwarding, runCommand)
      const pending = run(SESSION, signIn, firstCaller)
      const failure = await run(SESSION, signIn).catch((error: unknown) => error)
      const oppositeFailure = await run(SESSION, signIn, caller).catch((error: unknown) => error)
      const notOpened = forwarding.open(SESSION, 'private-challenge', 'other') === false
      finish()
      await pending
      expect(runCommand).toHaveBeenCalledOnce()
      expect(failure).toMatchObject({
        textKey: 'components.native-chat.droidHost.mcpSignInIncomplete'
      })
      expect(oppositeFailure).toMatchObject({
        textKey: 'components.native-chat.droidHost.mcpSignInIncomplete'
      })
      expect(notOpened).toBe(true)
      expect(send).not.toHaveBeenCalled()
      runCommand.mockResolvedValueOnce(RESULT)
      expect(await run(SESSION, signIn)).toEqual(RESULT)
    }
  )

  it('rejects another server before and during the intended acknowledgment without consuming it', async () => {
    const forwarding = new AgentSessionMcpSignInForwarding()
    let requestId = ''
    const send = vi.fn((request: { requestId: string }) => {
      requestId = request.requestId
    })
    forwarding.subscribe('reader', { ...caller, sessionId: SESSION, send })
    let finish = () => {}
    const run = bindMcpSignInCaller(
      forwarding,
      () =>
        new Promise<DroidHostCommandResult>((resolve) => {
          finish = () => resolve(RESULT)
        })
    )
    const pending = run(SESSION, signIn, caller)
    const before = forwarding.open(SESSION, 'private-challenge', 'other')
    const notSentBefore = send.mock.calls.length === 0
    const intended = forwarding.open(SESSION, 'private-challenge', 'intended')
    const during = forwarding.open(SESSION, 'private-challenge', 'other')
    const acknowledged = forwarding.acknowledge(
      SESSION,
      requestId,
      caller.connectionId,
      caller.callerKey,
      true
    )
    finish()
    const answer = await pending
    expect(before).toBe(false)
    expect(notSentBefore).toBe(true)
    expect(during).toBe(false)
    expect(send).toHaveBeenCalledOnce()
    expect(acknowledged).toBe(true)
    expect(await intended).toBe(true)
    expect(answer).toEqual(RESULT)
  })
})

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

  it.each<DroidHostCommandRequest>([
    { name: 'context' },
    { name: 'compress' },
    { name: 'fork' },
    { name: 'rewind', itemId: DROID_ROW }
  ])('starts the agent at rest for /$name', async (command) => {
    const { run, ensureAgent, droidCommand } = rig({ child: false })

    await run(command)

    expect(ensureAgent).toHaveBeenCalledWith(SESSION)
    expect(droidCommand).toHaveBeenCalledWith(expect.objectContaining({ fence: 7 }))
  })

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

    await expect(run({ name: 'context' })).rejects.toMatchObject({
      message: 'Droid commands are unavailable for this chat.',
      textKey: 'components.native-chat.droidHost.commandsUnavailable'
    })
  })

  it('keys a start that prepared successfully but left no child', async () => {
    const { run, droidCommand } = rig({ child: false, starts: false })

    await expect(run({ name: 'context' })).rejects.toMatchObject({
      message: 'Droid did not start for this chat. Send a message and try again.',
      textKey: 'components.native-chat.droidHost.notStarted'
    })
    expect(droidCommand).not.toHaveBeenCalled()
  })

  it('hands /fork to the child as it is, with no row of the chat named', async () => {
    const { run, droidCommand } = rig()

    await run({ name: 'fork' })

    expect(droidCommand).toHaveBeenCalledWith({
      sessionId: SESSION,
      fence: 7,
      command: { name: 'fork' }
    })
  })

  describe('a rewind to a row of the chat', () => {
    it('asks the child to rewind to the message Droid echoed for that row', async () => {
      const { run, droidCommand } = rig()

      await run({ name: 'rewind', itemId: DROID_ROW })

      expect(droidCommand).toHaveBeenCalledWith({
        sessionId: SESSION,
        fence: 7,
        command: { name: 'rewind', messageId: 'droid-message-1' }
      })
    })

    it('follows a send Orca placed to the message Droid accepted it as', async () => {
      const { run, droidCommand } = rig()

      await run({ name: 'rewind', itemId: SEND_ROW })

      expect(droidCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: { name: 'rewind', messageId: 'droid-message-2' } })
      )
    })

    it.each([
      ['a row that is not in the journal', 'missing-row'],
      ['a row of another agent', OTHER_ROW]
    ])('refuses %s, and asks the child nothing', async (_name, itemId) => {
      const { run, droidCommand } = rig()

      await expect(run({ name: 'rewind', itemId })).rejects.toMatchObject({
        message: 'Droid has no record of this message to rewind to.',
        textKey: 'components.native-chat.droidHost.rewindUnknownMessage'
      })
      expect(droidCommand).not.toHaveBeenCalled()
    })

    it('reads the journal under the session queue, like the fence', async () => {
      const { run, log } = rig()

      await run({ name: 'rewind', itemId: DROID_ROW })

      expect(log).toEqual(['adapter ran outside the session queue'])
    })
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
