// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { droidHelpText } from './droid-help-keys'
import type { DroidSessionCommands } from './use-droid-session-commands'
import { useNativeChatStructuredComposerTransport } from './use-native-chat-structured-composer-transport'

const mocks = vi.hoisted(
  (): {
    commands: DroidSessionCommands | undefined
    commandsArgs: Mock<(args: unknown) => void>
  } => ({
    commands: undefined,
    commandsArgs: vi.fn<(args: unknown) => void>()
  })
)

vi.mock('@/runtime/use-host-structured-agent', () => ({
  useStructuredAgentAcceptsImages: () => false
}))
vi.mock('./use-droid-session-commands', () => ({
  useDroidSessionCommands: (args: unknown) => {
    mocks.commandsArgs(args)
    return mocks.commands
  }
}))

type TransportArgs = Parameters<typeof useNativeChatStructuredComposerTransport>[0]

const OPTION_SURFACE = { autonomy: undefined, specPair: undefined }

function mountTransport(
  agent: string,
  extra: Partial<TransportArgs> = {},
  runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))
) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; the transport reads only the members stubbed here.
  const controller = {
    optionSnapshot: [],
    optionSurface: OPTION_SURFACE,
    setStructuredOption: async () => true,
    conversationCommands: ['clear', 'compact'],
    runConversationCommand
  } as unknown as TransportArgs['controller']
  return renderHook(() =>
    useNativeChatStructuredComposerTransport({
      props: { agent, tabId: 'tab-test', sessionId: 'session-test', target: { kind: 'local' } },
      controller,
      sendThroughLaunch: () => true,
      starting: false,
      worktreeId: undefined,
      optionPickerRequest: null,
      setOptionPickerRequest: vi.fn(),
      onError: vi.fn(),
      onSubmitted: vi.fn(),
      queuedMessages: { queueHold: undefined, queueResume: undefined },
      ...extra
    })
  ).result
}

function dispatch(
  agent: string,
  text: string,
  runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))
) {
  return mountTransport(agent, {}, runConversationCommand).current.dispatchCommand(text)
}

const dispatchHelp = (agent: string) => dispatch(agent, '/help')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.commands = undefined
})

describe('the commands a structured chat answers itself', () => {
  it('answers /help with the key list as information for Droid', async () => {
    expect(await dispatchHelp('droid')).toMatchObject({
      handled: true,
      accepted: true,
      error: null,
      info: droidHelpText()
    })
  })

  it.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'])(
    'says nothing as information for %s',
    async (agent) => {
      expect((await dispatchHelp(agent)).info).toBeUndefined()
    }
  )
})

describe('the session commands of a Droid chat', () => {
  function sessionCommands(answer: Awaited<ReturnType<DroidSessionCommands['runHostCommand']>>) {
    return {
      noteSubmit: vi.fn(),
      runHostCommand: vi.fn(async () => answer)
    } satisfies DroidSessionCommands
  }

  it("builds them from this chat's tab, agent and options", async () => {
    await dispatch('droid', 'hello')

    expect(mocks.commandsArgs).toHaveBeenCalledWith({
      tabId: 'tab-test',
      sessionId: 'session-test',
      target: { kind: 'local' },
      agent: 'droid',
      optionSnapshot: [],
      optionSurface: OPTION_SURFACE
    })
  })

  it('runs /clear there, ahead of the conversation command that clears the journal', async () => {
    const commands = sessionCommands({ accepted: false, error: null, info: 'Run /clear again.' })
    mocks.commands = commands
    const runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))

    expect(await dispatch('droid', '/clear', runConversationCommand)).toEqual({
      handled: true,
      accepted: false,
      error: null,
      info: 'Run /clear again.'
    })

    expect(commands.runHostCommand).toHaveBeenCalledWith('clear', '')
    expect(runConversationCommand).not.toHaveBeenCalled()
  })

  it.each([
    ['/context', 'context', ''],
    ['/cost', 'cost', ''],
    ['/compress remember the word ok', 'compress', 'remember the word ok'],
    ['/fork', 'fork', ''],
    ['/rewind-conversation', 'rewind-conversation', '']
  ])('claims %s for the host and sends no message', async (text, name, argument) => {
    const commands = sessionCommands({ accepted: true, error: null, info: 'answered' })
    mocks.commands = commands
    const runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))

    expect(await dispatch('droid', text, runConversationCommand)).toEqual({
      handled: true,
      accepted: true,
      error: null,
      info: 'answered'
    })

    expect(commands.runHostCommand).toHaveBeenCalledExactlyOnceWith(name, argument)
    expect(runConversationCommand).not.toHaveBeenCalled()
  })

  it('is told of every submit before it is dispatched, a message included', async () => {
    const commands = sessionCommands(null)
    mocks.commands = commands

    await dispatch('droid', 'fix the build')

    expect(commands.noteSubmit).toHaveBeenCalledWith('fix the build')
    expect(commands.runHostCommand).not.toHaveBeenCalled()
  })

  it('still clears the journal on /clear when the chat has no session commands', async () => {
    const runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))

    await dispatch('droid', '/clear', runConversationCommand)

    expect(runConversationCommand).toHaveBeenCalledWith('clear')
  })

  it.each(['claude', 'codex', 'pi', 'omp'])('never lets %s reach them', async (agent) => {
    const commands = sessionCommands({ accepted: false, error: null, info: 'asked' })
    mocks.commands = commands
    const runConversationCommand = vi.fn(async () => ({ accepted: true, error: null }))

    await dispatch(agent, '/clear', runConversationCommand)

    expect(commands.runHostCommand).not.toHaveBeenCalled()
    expect(runConversationCommand).toHaveBeenCalledWith('clear')
  })
})

describe('the rewind of a Droid chat', () => {
  const surface = { disabledReason: null, request: vi.fn() }

  function rewindOf(
    outcome: Awaited<ReturnType<NonNullable<TransportArgs['droidRewind']>['open']>>
  ) {
    return { surface, open: vi.fn(async () => outcome) }
  }

  it('is handed to the session commands, for /rewind-conversation', () => {
    const droidRewind = rewindOf({ accepted: true, error: null })

    mountTransport('droid', { droidRewind })

    expect(mocks.commandsArgs).toHaveBeenCalledWith(
      expect.objectContaining({ rewindConversation: droidRewind.open })
    )
  })

  it('gives the session commands none when the chat built none', () => {
    mountTransport('droid')

    expect(mocks.commandsArgs.mock.calls[0]?.[0]).not.toHaveProperty('rewindConversation')
  })

  it('opens from the composer, and says in the composer what stopped it', async () => {
    const onError = vi.fn()
    const droidRewind = rewindOf({
      accepted: false,
      error: 'Wait for Droid to finish before rewinding.'
    })
    const transport = mountTransport('droid', { droidRewind, onError })

    transport.current.openRewind?.()

    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledExactlyOnceWith('Wait for Droid to finish before rewinding.')
    )
    expect(droidRewind.open).toHaveBeenCalledOnce()
  })

  it.each([
    ['a rewind that ran', { accepted: true, error: null }],
    ['a rewind the person cancelled', { accepted: false, error: null }]
  ])('says nothing in the composer for %s', async (_label, outcome) => {
    const onError = vi.fn()
    const droidRewind = rewindOf(outcome)
    const transport = mountTransport('droid', { droidRewind, onError })

    transport.current.openRewind?.()
    await vi.waitFor(() => expect(droidRewind.open).toHaveBeenCalledOnce())
    await Promise.resolve()

    expect(onError).not.toHaveBeenCalled()
  })

  it('offers the composer no Esc rewind when the chat has none', () => {
    expect(mountTransport('droid').current.openRewind).toBeUndefined()
    expect(mountTransport('claude').current.openRewind).toBeUndefined()
  })
})
