// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import type { StructuredAgentLaunchSettlement } from '@/lib/structured-agent-launch-settlement'

const mocks = vi.hoisted(() => ({
  switchSession: vi.fn(),
  closeUnifiedTab: vi.fn(),
  toastError: vi.fn(),
  runChild: vi.fn()
}))

vi.mock('@/lib/droid-chat-session-switch', () => ({ switchDroidChatSession: mocks.switchSession }))
vi.mock('./droid-child-commands', () => ({ runDroidChildCommand: mocks.runChild }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ closeUnifiedTab: mocks.closeUnifiedTab }) }
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { useDroidSessionCommands } from './use-droid-session-commands'

const TAB = 'agent-session:droid-old'
const SESSION = 'session-old'
const TARGET = { kind: 'environment', environmentId: 'env-1' } as const

const SNAPSHOT: SessionOptionDescriptor[] = [
  {
    id: 'model',
    label: 'Model',
    kind: { type: 'select', currentValue: 'claude-haiku-5-5', choices: [] },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  },
  {
    id: 'planMode',
    label: 'Spec',
    kind: { type: 'boolean', currentValue: true },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }
]

type HookArgs = Parameters<typeof useDroidSessionCommands>[0]

const SURFACE: NonNullable<HookArgs['optionSurface']> = {
  autonomy: { level: 'low', levels: ['off', 'low', 'medium', 'high'], settable: true },
  specPair: { model: 'spec-1', effort: 'low', modelChoices: [], effortChoices: [], settable: true }
}

function mount(extra: Partial<HookArgs> = {}) {
  return renderHook(() =>
    useDroidSessionCommands({
      tabId: TAB,
      sessionId: SESSION,
      target: TARGET,
      agent: 'droid',
      optionSnapshot: SNAPSHOT,
      optionSurface: SURFACE,
      ...extra
    })
  ).result
}

function run(commands: ReturnType<typeof mount>, text: string) {
  const [name = '', ...rest] = text.slice(1).split(' ')
  commands.current?.noteSubmit(text)
  return commands.current?.runHostCommand(name, rest.join(' '))
}

function settles(settled: StructuredAgentLaunchSettlement): void {
  mocks.switchSession.mockReturnValue({ settlement: Promise.resolve(settled) })
}

const ASK_CLEAR =
  'Run /clear again to start a new session that keeps these settings. This session stays in Session History.'
const ASK_NEW =
  'Run /new again to start a new session with the settings of a new chat. This session stays in Session History.'
const askClose = (name: string) =>
  `Run /${name} again to close this chat. It stays in Session History.`

beforeEach(() => {
  vi.clearAllMocks()
  settles({ kind: 'structured', sessionId: 'droid-new' })
})

describe('/clear and /new in a Droid chat', () => {
  it('asks again on the first submit, and does not switch or close', async () => {
    const commands = mount()

    expect(await run(commands, '/clear')).toEqual({ accepted: false, error: null, info: ASK_CLEAR })
    expect(await run(commands, '/new')).toEqual({ accepted: false, error: null, info: ASK_NEW })

    expect(mocks.switchSession).not.toHaveBeenCalled()
    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it('switches the tab in place to a fresh session that keeps the settings, on the second /clear', async () => {
    const commands = mount()

    await run(commands, '/clear')
    expect(await run(commands, '/clear')).toEqual({ accepted: true, error: null })

    expect(mocks.switchSession).toHaveBeenCalledOnce()
    expect(mocks.switchSession).toHaveBeenCalledWith({
      fromTabId: TAB,
      placement: 'replace',
      target: {
        kind: 'fresh',
        settings: {
          model: 'claude-haiku-5-5',
          spec: true,
          autonomyLevel: 'low',
          specModel: 'spec-1',
          specEffort: 'low'
        }
      }
    })
    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it('switches to a fresh session with the settings of a new chat on the second /new', async () => {
    const commands = mount()

    await run(commands, '/new')
    await run(commands, '/new')

    expect(mocks.switchSession).toHaveBeenCalledOnce()
    expect(mocks.switchSession).toHaveBeenCalledWith({
      fromTabId: TAB,
      placement: 'replace',
      target: { kind: 'fresh', settings: { spec: false } }
    })
  })

  it('asks again for the next one once a switch has been made', async () => {
    const commands = mount()
    await run(commands, '/new')
    await run(commands, '/new')

    expect(await run(commands, '/new')).toMatchObject({ accepted: false, info: ASK_NEW })
    expect(mocks.switchSession).toHaveBeenCalledOnce()
  })

  it('takes a different command for a new question, not for the answer', async () => {
    const commands = mount()

    await run(commands, '/clear')
    expect(await run(commands, '/new')).toMatchObject({ accepted: false, info: ASK_NEW })
    expect(await run(commands, '/quit')).toMatchObject({ accepted: false })
    expect(await run(commands, '/clear')).toMatchObject({ accepted: false, info: ASK_CLEAR })

    expect(mocks.switchSession).not.toHaveBeenCalled()
    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it.each(['fix the build', '/model sonnet', '/help'])(
    'asks again when %s was submitted in between',
    async (between) => {
      const commands = mount()

      await run(commands, '/clear')
      commands.current?.noteSubmit(between)

      expect(await run(commands, '/clear')).toMatchObject({ accepted: false, info: ASK_CLEAR })
      expect(mocks.switchSession).not.toHaveBeenCalled()
    }
  )

  it('takes the same command in another case or with spaces around it for the answer', async () => {
    const commands = mount()

    await run(commands, '/clear')
    commands.current?.noteSubmit('  /CLEAR ')
    await commands.current?.runHostCommand('clear', '')

    expect(mocks.switchSession).toHaveBeenCalledOnce()
  })

  it('refuses an argument without asking, and without taking a pending ask for the answer', async () => {
    const commands = mount()

    await run(commands, '/new')
    expect(await run(commands, '/new now')).toEqual({
      accepted: false,
      error: 'Use /new without arguments.'
    })
    expect(await run(commands, '/new')).toMatchObject({ accepted: false, info: ASK_NEW })
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('leaves /help to the shared answer', async () => {
    expect(await run(mount(), '/help')).toBeNull()
  })

  it('keeps nothing of a setting the tab only shows as a default', async () => {
    const commands = mount({
      optionSnapshot: SNAPSHOT.map((row) => ({ ...row, valueSource: 'default' as const })),
      optionSurface: undefined
    })

    await run(commands, '/clear')
    await run(commands, '/clear')

    expect(mocks.switchSession).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'fresh', settings: {} } })
    )
  })
})

describe('when the fresh session cannot be opened', () => {
  it('says so once when nothing else did, and leaves the chat open', async () => {
    settles({ kind: 'failed', error: new Error('refused') })
    const commands = mount()

    await run(commands, '/new')
    await run(commands, '/new')
    await Promise.resolve()

    expect(mocks.toastError).toHaveBeenCalledOnce()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Could not start the new Droid session. This chat is still open.'
    )
    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it('does not say it twice when the launch already told the person', async () => {
    settles({ kind: 'failed', error: new Error('refused'), notified: true })
    const commands = mount()

    await run(commands, '/new')
    await run(commands, '/new')
    await Promise.resolve()

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says so when the switch cannot start at all', async () => {
    mocks.switchSession.mockImplementation(() => {
      throw new Error('Only a Droid chat can switch to another Droid session.')
    })
    const commands = mount()

    await run(commands, '/clear')
    expect(await run(commands, '/clear')).toEqual({ accepted: false, error: null })

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Could not start the new Droid session. This chat is still open.'
    )
  })
})

describe('/quit and /exit in a Droid chat', () => {
  it.each(['quit', 'exit'])('asks again on the first /%s, and closes nothing yet', async (name) => {
    const commands = mount()

    expect(await run(commands, `/${name}`)).toEqual({
      accepted: false,
      error: null,
      info: askClose(name)
    })

    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it.each(['quit', 'exit'])('closes the tab on the second /%s', async (name) => {
    const commands = mount()

    await run(commands, `/${name}`)
    expect(await run(commands, `/${name}`)).toEqual({ accepted: true, error: null })

    expect(mocks.closeUnifiedTab).toHaveBeenCalledOnce()
    expect(mocks.closeUnifiedTab).toHaveBeenCalledWith(TAB)
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('does not take /exit for the answer to /quit', async () => {
    const commands = mount()

    await run(commands, '/quit')
    expect(await run(commands, '/exit')).toMatchObject({ accepted: false, info: askClose('exit') })

    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
  })
})

describe('/context, /cost and /compress in a Droid chat', () => {
  it.each([
    ['context', ''],
    ['cost', ''],
    ['compress', 'remember the word ok']
  ] as const)('hands /%s to the Droid child at once, with what follows it', async (name, rest) => {
    const answer = { accepted: true, error: null, info: 'answered' }
    mocks.runChild.mockResolvedValue(answer)
    const commands = mount()

    expect(await run(commands, `/${name} ${rest}`.trimEnd())).toBe(answer)

    expect(mocks.runChild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tabId: TAB, sessionId: SESSION, target: TARGET }),
      name,
      rest
    )
    expect(mocks.switchSession).not.toHaveBeenCalled()
    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
  })

  it('gives /compress the settings the tab runs on, to carry to a session it moves to', async () => {
    mocks.runChild.mockResolvedValue({ accepted: true, error: null })
    const commands = mount()

    await run(commands, '/compress')

    const [chat] = mocks.runChild.mock.calls[0] ?? []
    expect(chat.keptSettings()).toEqual({
      model: 'claude-haiku-5-5',
      spec: true,
      autonomyLevel: 'low',
      specModel: 'spec-1',
      specEffort: 'low'
    })
  })

  it('does not count /context as the second submit that confirms /clear', async () => {
    mocks.runChild.mockResolvedValue({ accepted: true, error: null })
    const commands = mount()

    await run(commands, '/clear')
    await run(commands, '/context')

    expect(await run(commands, '/clear')).toMatchObject({ accepted: false, info: ASK_CLEAR })
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })
})

describe('a chat that is not Droid', () => {
  it.each(['claude', 'codex', 'pi', 'omp', 'grok', 'opencode'] as const)(
    'has no session commands for %s, so its own /clear is left alone',
    (agent) => {
      expect(mount({ agent }).current).toBeUndefined()
    }
  )
})
