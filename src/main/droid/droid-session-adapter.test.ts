import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import { messageText } from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import {
  AgentSessionAcquisitionExitProvenError,
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionAcquisitionRootExitObservedError,
  AgentSessionPromptUnavailableError
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { providerStartupFailureFact } from '../native-chat/agent-session-wire/structured-agent-session-failure-text'
import { withMissingProviderExecutable } from '../provider-process/provider-executable-missing'
import { agentSessionLaunchFolderMissing } from '../runtime/agent-session-launch-directory'
import { isAgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import {
  DROID_RIG_SESSION,
  FakeConnection,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { DroidRpcError } from './droid-rpc-errors'
import { DroidSessionAdapter } from './droid-session-adapter'
import { buildDroidExecLaunch } from './droid-exec-launch'

const sessionId = DROID_RIG_SESSION
const setup = setupDroidAdapter
afterEach(runDroidRigCleanups)

const text = (value: string): AgentJournalMessageItem => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: value }]
})

const assistantRows = async (h: Awaited<ReturnType<typeof setup>>) =>
  (await h.rig.rows()).flatMap(({ body }) =>
    body.kind === 'message' && body.role === 'assistant' ? [messageText(body)] : []
  )

describe('Droid session start', () => {
  it('spawns droid exec, records the child before any request, and initializes a new session', async () => {
    const h = await setup()
    const { acquired, connection } = await h.start()

    expect(h.openConnection.mock.calls[0]?.[0]).toMatchObject(
      buildDroidExecLaunch({
        command: '/host/bin/droid',
        cwd: '/host/folder',
        env: { PATH: '/host/bin' },
        structuredSession: { id: sessionId, spawnToken: 'spawn-token' }
      })
    )
    expect(h.onSpawned).toHaveBeenCalledOnce()
    expect(connection.requests.map(({ method }) => method)).toEqual(['droid.initialize_session'])
    expect(connection.requests[0]?.params).toEqual({
      machineId: expect.any(String),
      cwd: '/host/folder',
      interactionMode: 'auto',
      autonomyLevel: 'high'
    })
    expect(acquired.link).toMatchObject({
      handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-1' },
      origin: 'created',
      mintedAtFence: 7
    })
    expect(acquired.process).toMatchObject({ pid: 4123, spawnToken: 'spawn-token' })
  })

  it('names the session from the shape a real Droid answers with', async () => {
    const h = await setup()
    h.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.replies.set('droid.initialize_session', () => ({
        sessionId: 'droid-session-real',
        hostId: 'host-1',
        session: { messages: [] },
        settings: { interactionMode: 'auto' }
      }))
      h.connections.push(connection)
      return connection
    })

    const { acquired } = await h.start()

    expect(acquired.link).toMatchObject({ handle: { nativeId: 'droid-session-real' } })
  })

  it('refuses a new session whose answer names no session', async () => {
    const h = await setup()
    h.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.replies.set('droid.initialize_session', () => ({ session: { messages: [] } }))
      h.connections.push(connection)
      return connection
    })

    await expect(h.start()).rejects.toThrow('Droid did not name its session')
    expect(h.connections[0]?.closed).toBe(true)
  })

  it('never starts a Mission', async () => {
    const h = await setup()
    const { connection } = await h.start()
    expect(JSON.stringify(connection.requests)).not.toContain('mission')
  })

  it.each([
    ['Manual', 'off'],
    ['Auto Low', 'low'],
    ['Auto Medium', 'medium'],
    ['Yolo', 'high']
  ] as const)('starts a new session at the %s autonomy level it resolved', async (_name, level) => {
    const h = await setup({ autonomyLevel: level })
    const { connection } = await h.start()
    expect(connection.requests[0]?.params).toMatchObject({ autonomyLevel: level })
  })

  it.each([
    ['true', 'spec'],
    ['false', 'auto']
  ])('starts a new session with the saved Spec value %s in %s mode', async (saved, mode) => {
    const h = await setup()
    const { connection } = await h.start({ planMode: saved })
    expect(connection.requests[0]?.params).toMatchObject({ interactionMode: mode })
  })

  it('starts in auto mode when the saved Spec value is not a boolean', async () => {
    const h = await setup()
    const { connection } = await h.start({ planMode: 'spec' })
    expect(connection.requests[0]?.params).toMatchObject({ interactionMode: 'auto' })
  })

  const heldSession = {
    linkId: 'prior',
    handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-9' },
    origin: 'created' as const,
    mintedAtFence: 1,
    observedAt: 100
  }

  it('loads the session the chat last held, and names no folder or mode', async () => {
    const h = await setup({ previous: heldSession })
    const { acquired, connection } = await h.start()

    expect(connection.requests[0]).toMatchObject({
      method: 'droid.load_session',
      params: { sessionId: 'droid-session-9' }
    })
    expect(acquired.link).toMatchObject({
      origin: 'resumed',
      handle: { nativeId: 'droid-session-9' }
    })
  })

  it('re-sends the resolved level and Spec mode after a load, never the stored ones', async () => {
    const h = await setup({ previous: heldSession, autonomyLevel: 'off' })
    const { connection } = await h.start({ planMode: 'true' })

    expect(connection.requests.map(({ method }) => method)).toEqual([
      'droid.load_session',
      'droid.update_session_settings'
    ])
    expect(connection.requests[1]?.params).toEqual({
      autonomyLevel: 'off',
      interactionMode: 'spec'
    })
  })

  it('re-sends auto mode after a load when the chat saved no Spec', async () => {
    const h = await setup({ previous: heldSession, autonomyLevel: 'high' })
    const { connection } = await h.start()
    expect(connection.requests[1]?.params).toEqual({
      autonomyLevel: 'high',
      interactionMode: 'auto'
    })
  })

  it('fails the start, and closes the child, when Droid refuses the settings after a load', async () => {
    const h = await setup({ previous: heldSession })
    h.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32603, 'Settings refused')
      })
      h.connections.push(connection)
      return connection
    })
    await expect(h.start()).rejects.toThrow()
    expect(h.connections[0]?.closed).toBe(true)
  })

  it('fails the start when Droid loads a different session than it was asked for', async () => {
    const previous = {
      linkId: 'prior',
      handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-9' },
      origin: 'created' as const,
      mintedAtFence: 1,
      observedAt: 100
    }
    const h = await setup({ previous })
    h.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.replies.set('droid.load_session', () => ({ session: { id: 'someone-else' } }))
      h.connections.push(connection)
      return connection
    })
    await expect(h.start()).rejects.toThrow()
    expect(h.connections[0]?.closed).toBe(true)
  })

  it.each([
    ['another major', '2.0.0'],
    ['no stamp at all', undefined]
  ])(
    'refuses a Droid whose protocol has %s, as the release refusal, and closes the child',
    async (_name, stamp) => {
      const h = await setup()
      h.openConnection.mockImplementationOnce((_launch, handlers) => {
        const connection = new FakeConnection(handlers)
        connection.protocolVersion = stamp
        h.connections.push(connection)
        return connection
      })

      await expect(h.start()).rejects.toMatchObject({
        name: 'AgentSessionPreSpawnError',
        releaseFacts: {}
      })
      const connection = h.connections[0]
      expect(connection?.closed).toBe(true)
      expect(connection?.requests.map(({ method }) => method)).toEqual(['droid.initialize_session'])
    }
  )

  it('does not call a refusal before spawn when the child it closed is not proven gone', async () => {
    const h = await setup()
    h.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.protocolVersion = '2.0.0'
      connection.closeResult = { root: 'unverifiable', tree: 'unverifiable' }
      h.connections.push(connection)
      return connection
    })
    await expect(h.start()).rejects.toBeInstanceOf(AgentSessionAcquisitionExitUnprovenError)
  })

  it('reports a start Droid refused as an observed exit, or a processless one as proven', async () => {
    const refusing = await setup()
    refusing.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.replies.set('droid.initialize_session', () => {
        throw new DroidRpcError(-32603, 'Internal error')
      })
      refusing.connections.push(connection)
      return connection
    })
    await expect(refusing.start()).rejects.toBeInstanceOf(
      AgentSessionAcquisitionRootExitObservedError
    )

    const processless = await setup()
    processless.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.processless = true
      connection.replies.set('droid.initialize_session', () => {
        throw new Error('Droid process could not start')
      })
      processless.connections.push(connection)
      return connection
    })
    await expect(processless.start()).rejects.toBeInstanceOf(AgentSessionAcquisitionExitProvenError)
  })

  it('words a start with no droid installed as a missing CLI, through the acquisition error', async () => {
    const h = await setup()
    h.openConnection.mockImplementationOnce((_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.processless = true
      connection.replies.set('droid.initialize_session', () => {
        throw withMissingProviderExecutable(new Error('Droid process could not start'))
      })
      h.connections.push(connection)
      return connection
    })
    const failure = await h.start().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentSessionAcquisitionExitProvenError)
    expect(providerStartupFailureFact(failure).kind).toBe('cliMissing')
  })

  it('refuses a launch the resolver refused, with its reason, without spawning', async () => {
    const h = await setup()
    const adapter = new DroidSessionAdapter({
      resolveLaunch: async () => {
        throw agentSessionLaunchFolderMissing('/gone/floating')
      },
      openConnection: h.openConnection,
      onLifecycle: h.lifecycle,
      onSettled: h.settled,
      onIdle: h.idle,
      logger: { warn: vi.fn(), error: vi.fn() }
    })
    await expect(adapter.acquire(h.input)).rejects.toMatchObject({
      name: 'AgentSessionPreSpawnError',
      reason: 'launchFolderMissing'
    })
    expect(h.connections).toHaveLength(0)
  })
})

describe('Droid session turns', () => {
  it('admits a send, accepts it on the echo of its request, and journals the reply', async () => {
    const h = await setup()
    const { connection } = await h.start()

    const outcome = await h.adapter.dispatch({
      sessionId,
      clientMessageId: 'send-1',
      body: text('hello'),
      fence: 7
    })

    expect(outcome).toEqual({ state: 'admitted' })
    expect(connection.requests.at(-1)).toMatchObject({
      method: 'droid.add_user_message',
      params: { text: 'hello' }
    })
    expect(h.adapter.holdsDispatch(sessionId)).toBe(true)
    connection.notify({
      type: 'droid_working_state_changed',
      newState: 'streaming_assistant_message'
    })
    connection.echo('hello')
    connection.notify({
      type: 'create_message',
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hi there' }] }
    })
    connection.notify({ type: 'agent_turn_completed', reason: 'completed' })

    await vi.waitFor(() =>
      expect(h.settled).toHaveBeenCalledWith({
        sessionId,
        clientMessageId: 'send-1',
        fence: 7,
        outcome: {
          state: 'accepted',
          providerIdentity: { provider: 'orca', clientMessageId: 'send-1' }
        }
      })
    )
    await vi.waitFor(async () => expect(await assistantRows(h)).toEqual(['hi there']))
    expect(h.idle).toHaveBeenCalledWith({ sessionId })
    expect(h.adapter.holdsDispatch(sessionId)).toBe(false)
  })

  it('rejects a message with nothing Droid can read, without writing', async () => {
    const h = await setup()
    const { connection } = await h.start()
    const before = connection.requests.length

    const empty = await h.adapter.dispatch({
      sessionId,
      clientMessageId: 'send-1',
      body: { kind: 'message', role: 'user', blocks: [] },
      fence: 7
    })
    const image = await h.adapter.dispatch({
      sessionId,
      clientMessageId: 'send-2',
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'image-ref', path: '/tmp/a.png' }]
      },
      fence: 7
    })

    expect(empty).toMatchObject({ state: 'rejected' })
    expect(image).toMatchObject({ state: 'rejected' })
    expect(connection.requests).toHaveLength(before)
  })

  it('joins the text blocks of a message', async () => {
    const h = await setup()
    const { connection } = await h.start()
    await h.adapter.dispatch({
      sessionId,
      clientMessageId: 'send-1',
      body: {
        kind: 'message',
        role: 'user',
        blocks: [
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' }
        ]
      },
      fence: 7
    })
    expect(connection.requests.at(-1)?.params).toEqual({ text: 'one\ntwo' })
  })

  it('asks the revalidation before writing, and writes nothing when it refuses', async () => {
    const h = await setup()
    const { connection } = await h.start()
    const before = connection.requests.length
    await expect(
      h.adapter.dispatch({
        sessionId,
        clientMessageId: 'send-1',
        body: text('hello'),
        fence: 7,
        beforeDispatch: async () => {
          throw new Error('superseded')
        }
      })
    ).rejects.toThrow('superseded')
    expect(connection.requests).toHaveLength(before)
    expect(h.adapter.holdsDispatch(sessionId)).toBe(false)
  })

  it('refuses a dispatch under another fence', async () => {
    const h = await setup()
    await h.start()
    await expect(
      h.adapter.dispatch({ sessionId, clientMessageId: 'send-1', body: text('hi'), fence: 8 })
    ).rejects.toThrow('not live under this fence')
  })
})

describe('Droid session stop', () => {
  it('interrupts the session, names the turn it stopped, and ends the child after a Stop', async () => {
    const h = await setup()
    const { connection } = await h.start()
    await h.adapter.dispatch({ sessionId, clientMessageId: 'send-1', body: text('hi'), fence: 7 })
    connection.notify({
      type: 'droid_working_state_changed',
      newState: 'streaming_assistant_message'
    })
    connection.echo('hi')
    await vi.waitFor(() => expect(h.settled).toHaveBeenCalled())

    const outcome = await h.adapter.cancelTurn({ sessionId, fence: 7 })

    expect(outcome).toMatchObject({ cancelled: true, turnId: expect.any(String) })
    expect(connection.requests.at(-1)).toEqual({
      method: 'droid.interrupt_session',
      params: {},
      timeoutMs: 2_000
    })
    expect(h.adapter.stopEndsSession()).toBe(true)
  })

  it('has nothing to interrupt with no turn and no send in flight', async () => {
    const h = await setup()
    const { connection } = await h.start()
    const before = connection.requests.length
    await expect(h.adapter.cancelTurn({ sessionId, fence: 7 })).resolves.toEqual({
      cancelled: false
    })
    expect(connection.requests).toHaveLength(before)
  })

  it('does not interrupt a turn the caller did not name', async () => {
    const h = await setup()
    const { connection } = await h.start()
    await h.adapter.dispatch({ sessionId, clientMessageId: 'send-1', body: text('hi'), fence: 7 })
    connection.notify({
      type: 'droid_working_state_changed',
      newState: 'streaming_assistant_message'
    })
    const before = connection.requests.length
    await expect(
      h.adapter.cancelTurn({ sessionId, fence: 7, turnId: 'some-older-turn' })
    ).resolves.toEqual({ cancelled: false })
    expect(connection.requests).toHaveLength(before)
  })
})

describe('Droid session end', () => {
  it('publishes an unexpected exit and leaves an unconfirmed send unknown', async () => {
    const h = await setup()
    const { connection } = await h.start()
    connection.replies.set('droid.add_user_message', () => new Promise(() => {}))
    void h.adapter.dispatch({ sessionId, clientMessageId: 'send-1', body: text('hi'), fence: 7 })
    await Promise.resolve()

    connection.exit()
    await h.adapter.drainObservedExits()

    expect(h.lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ended', sessionId, fence: 7, cause: 'unexpected-exit' })
    )
    expect(h.settled).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: 'send-1',
        outcome: { state: 'unknown', reason: 'Droid ended before confirming delivery' }
      })
    )
  })

  it('reports a requested close as requested', async () => {
    const h = await setup()
    await h.start()
    await expect(h.adapter.closeSession(sessionId)).resolves.toBe(true)
    await h.adapter.drainObservedExits()
    expect(h.lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ended', cause: 'requested-close' })
    )
  })

  it('closes the child when Droid sends a notification it cannot read', async () => {
    const h = await setup()
    const { connection } = await h.start()
    connection.notify({ type: 'tool_call' })
    await vi.waitFor(() => expect(connection.closed).toBe(true))
    await h.adapter.drainObservedExits()
    expect(h.lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ended', cause: 'unexpected-exit' })
    )
  })

  it('ignores a notification of a kind it does not know', async () => {
    const h = await setup()
    const { connection } = await h.start()
    connection.notify({ type: 'settings_updated', settings: {} })
    expect(connection.closed).toBe(false)
  })
})

describe('Droid session options and prompts', () => {
  it('rejects an option pick, and an answer to a card Droid is not waiting on, without ending the session', async () => {
    const h = await setup()
    const { connection } = await h.start()

    const option = h.adapter.setOption({ sessionId, key: 'model', value: 'x', fence: 7 })
    await expect(option).rejects.toSatisfy(isAgentSessionOptionRejectedError)
    await expect(
      h.adapter.answerPrompt({
        sessionId,
        itemId: 'item-1',
        kind: 'approval',
        response: { kind: 'option', optionId: 'approve' },
        fence: 7,
        commit: vi.fn(async () => {})
      })
    ).rejects.toBeInstanceOf(AgentSessionPromptUnavailableError)
    expect(connection.closed).toBe(false)
  })
})
