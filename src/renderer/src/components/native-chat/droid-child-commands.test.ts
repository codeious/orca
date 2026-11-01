import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH,
  type DroidHostCommandResult
} from '../../../../shared/droid-host-command'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  switchSession: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/lib/droid-chat-session-switch', () => ({ switchDroidChatSession: mocks.switchSession }))
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: mocks.toastError }) }))

import { runDroidChildCommand, type DroidChildCommandChat } from './droid-child-commands'

const KEPT = { model: 'claude-haiku-5-5', spec: false }

const renameTab = vi.fn<DroidChildCommandChat['renameTab']>()

const CHAT: DroidChildCommandChat = {
  tabId: 'agent-session:droid-old',
  sessionId: 'session-1',
  target: { kind: 'environment', environmentId: 'env-1' },
  keptSettings: () => KEPT,
  renameTab
}

const REPORT = {
  model: 'claude-haiku-5-5',
  usedTokens: 10501,
  windowTokens: 250000,
  percentage: 4,
  categories: [
    { name: 'System prompt', tokens: 1558 },
    { name: 'System tools', tokens: 8862 },
    { name: 'MCP tools', tokens: 0 },
    { name: 'Custom agents', tokens: 81 }
  ],
  capturedAt: 1
}

function answers(result: DroidHostCommandResult | Error): void {
  if (result instanceof Error) {
    mocks.call.mockRejectedValue(result)
  } else {
    mocks.call.mockResolvedValue(result)
  }
}

function settles(settled: unknown): void {
  mocks.switchSession.mockReturnValue({ settlement: Promise.resolve(settled) })
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  settles({ kind: 'structured', sessionId: 'session-new' })
})

describe('/context in a Droid chat', () => {
  it("asks the chat's host once and says used, window and what is left, with the categories Droid gave", async () => {
    answers({ name: 'context', report: REPORT })

    const outcome = await runDroidChildCommand(CHAT, 'context', '')

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
      sessionId: 'session-1',
      command: { name: 'context' }
    })
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: 'Context: 10,501 of 250,000 tokens used (4%), 239,499 left. By category: System tools 8,862 (3.5%), System prompt 1,558 (0.6%), Custom agents 81 (0%).'
    })
  })

  it('leaves the category line out when Droid gave none', async () => {
    answers({ name: 'context', report: { ...REPORT, categories: [] } })

    expect((await runDroidChildCommand(CHAT, 'context', '')).info).toBe(
      'Context: 10,501 of 250,000 tokens used (4%), 239,499 left.'
    )
  })

  it('reads an over-limit session as nothing left, not a negative figure', async () => {
    answers({
      name: 'context',
      report: { ...REPORT, usedTokens: 260000, percentage: 104, categories: [] }
    })

    expect((await runDroidChildCommand(CHAT, 'context', '')).info).toBe(
      'Context: 260,000 of 250,000 tokens used (104%), 0 left.'
    )
  })

  it('says so when Droid answered with nothing readable', async () => {
    answers({ name: 'context', report: null })

    expect(await runDroidChildCommand(CHAT, 'context', '')).toEqual({
      accepted: false,
      error: 'Droid did not report its context usage. Try again.'
    })
  })

  it('refuses an argument without asking Droid', async () => {
    expect(await runDroidChildCommand(CHAT, 'context', 'now')).toEqual({
      accepted: false,
      error: 'Use /context without arguments.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })
})

describe('/cost in a Droid chat', () => {
  it('asks the host for the credits Droid reported, and calls no cost method', async () => {
    answers({ name: 'credits', factoryCredits: 12.5 })

    const outcome = await runDroidChildCommand(CHAT, 'cost', '')

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
      sessionId: 'session-1',
      command: { name: 'credits' }
    })
    expect(mocks.call.mock.calls.map(([, method]) => method).join()).not.toMatch(/cost/i)
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: 'Factory credits used in this session: 12.5.'
    })
  })

  it('shows zero as a figure', async () => {
    answers({ name: 'credits', factoryCredits: 0 })

    expect((await runDroidChildCommand(CHAT, 'cost', '')).info).toBe(
      'Factory credits used in this session: 0.'
    )
  })

  it('invents no figure when Droid has reported none', async () => {
    answers({ name: 'credits', factoryCredits: null })

    expect(await runDroidChildCommand(CHAT, 'cost', '')).toEqual({
      accepted: true,
      error: null,
      info: 'Droid has not reported Factory credits for this session yet.'
    })
  })

  it('refuses an argument without asking Droid', async () => {
    expect((await runDroidChildCommand(CHAT, 'cost', 'all')).error).toBe(
      'Use /cost without arguments.'
    )
    expect(mocks.call).not.toHaveBeenCalled()
  })
})

describe('/compress in a Droid chat', () => {
  it('asks once, with no instructions when none were typed, and leaves the words to the chat row', async () => {
    answers({ name: 'compress', removedCount: 3, newSessionId: null })

    const outcome = await runDroidChildCommand(CHAT, 'compress', '')

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
      sessionId: 'session-1',
      command: { name: 'compress' }
    })
    expect(outcome).toEqual({ accepted: true, error: null })
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('sends what follows the command as the instructions', async () => {
    answers({ name: 'compress', removedCount: null, newSessionId: null })

    await runDroidChildCommand(CHAT, 'compress', 'remember the word ok')

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
      sessionId: 'session-1',
      command: { name: 'compress', instructions: 'remember the word ok' }
    })
  })

  it('keeps the tab when Droid answers with its own session', async () => {
    answers({ name: 'compress', removedCount: 0, newSessionId: null })

    await runDroidChildCommand(CHAT, 'compress', '')
    await flush()

    expect(mocks.switchSession).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('moves the tab in place to a different session, keeping what the tab runs on', async () => {
    answers({ name: 'compress', removedCount: null, newSessionId: 'droid-session-2' })

    expect(await runDroidChildCommand(CHAT, 'compress', '')).toEqual({
      accepted: true,
      error: null
    })
    await flush()

    expect(mocks.switchSession).toHaveBeenCalledExactlyOnceWith({
      fromTabId: CHAT.tabId,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: 'droid-session-2', settings: KEPT }
    })
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
    )
  })

  it('says so, once, when the new session could not be opened and nothing else did', async () => {
    answers({ name: 'compress', removedCount: null, newSessionId: 'droid-session-2' })
    settles({ kind: 'failed', notified: false })

    await runDroidChildCommand(CHAT, 'compress', '')
    await flush()

    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Droid compressed the conversation into a new session, but Orca could not open it. The earlier session stays in Session History.'
    )
  })

  it('stays quiet when the launch already told the person', async () => {
    answers({ name: 'compress', removedCount: null, newSessionId: 'droid-session-2' })
    settles({ kind: 'failed', notified: true })

    await runDroidChildCommand(CHAT, 'compress', '')
    await flush()

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says so when the switch cannot start at all', async () => {
    answers({ name: 'compress', removedCount: null, newSessionId: 'droid-session-2' })
    mocks.switchSession.mockImplementation(() => {
      throw new Error('not a Droid chat')
    })

    expect(await runDroidChildCommand(CHAT, 'compress', '')).toEqual({
      accepted: true,
      error: null
    })
    expect(mocks.toastError).toHaveBeenCalledOnce()
  })

  it('refuses instructions longer than Droid is asked to weigh, without asking', async () => {
    const outcome = await runDroidChildCommand(
      CHAT,
      'compress',
      'x'.repeat(DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH + 1)
    )

    expect(outcome).toEqual({
      accepted: false,
      error: 'Keep the /compress instructions under 8000 characters.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('takes a second /compress as busy while the first still runs', async () => {
    let finish: (result: DroidHostCommandResult) => void = () => undefined
    mocks.call.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    const first = runDroidChildCommand(CHAT, 'compress', '')
    const second = await runDroidChildCommand(CHAT, 'compress', '')
    finish({ name: 'compress', removedCount: 1, newSessionId: null })
    await first

    expect(second).toEqual({
      accepted: false,
      error: 'Droid is still compressing this conversation.'
    })
    expect(mocks.call).toHaveBeenCalledOnce()
    expect(await runDroidChildCommand(CHAT, 'compress', '')).toMatchObject({ accepted: true })
  })
})

describe('/fork in a Droid chat', () => {
  const FORK_COMMAND = { sessionId: 'session-1', command: { name: 'fork' } }

  async function fork() {
    const outcome = await runDroidChildCommand(CHAT, 'fork', '')
    if (!outcome.infoAction) {
      throw new Error('the fork offered no action')
    }
    return { outcome, open: outcome.infoAction.onClick }
  }

  it('asks the host for a fork with no title of ours and no session id, and offers Open fork', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork' })

    const { outcome } = await fork()

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(
      CHAT.target,
      'agentSession.droidCommand',
      FORK_COMMAND
    )
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: 'Forked this conversation. This chat stays on the original session.',
      infoAction: { label: 'Open fork', onClick: expect.any(Function) }
    })
  })

  it('leaves the tab on the original session until Open fork is pressed', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork' })

    await fork()
    await flush()

    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('opens the fork as a new tab beside this one, as an existing session, keeping the settings', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork' })
    const { open } = await fork()

    open()
    await flush()

    expect(mocks.switchSession).toHaveBeenCalledExactlyOnceWith({
      fromTabId: CHAT.tabId,
      placement: 'beside',
      target: { kind: 'existing', droidSessionId: 'droid-session-fork', settings: KEPT }
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('gives a second /fork its own action, for its own session', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork-1' })
    const first = await fork()
    answers({ name: 'fork', newSessionId: 'droid-session-fork-2' })
    const second = await fork()

    second.open()
    first.open()

    expect(
      mocks.switchSession.mock.calls.map(([request]) => request.target.droidSessionId)
    ).toEqual(['droid-session-fork-2', 'droid-session-fork-1'])
  })

  it('says so, once, when the fork could not be opened and nothing else did', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork' })
    const { open } = await fork()
    settles({ kind: 'failed', notified: false })

    open()
    await flush()

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Droid forked the conversation, but Orca could not open the fork. This chat is still on the original session.'
    )
  })

  it('stays quiet when the launch already told the person', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork' })
    const { open } = await fork()
    settles({ kind: 'failed', notified: true })

    open()
    await flush()

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says so when the switch cannot start at all', async () => {
    answers({ name: 'fork', newSessionId: 'droid-session-fork' })
    const { open } = await fork()
    mocks.switchSession.mockImplementation(() => {
      throw new Error('not a Droid chat')
    })

    open()

    expect(mocks.toastError).toHaveBeenCalledOnce()
  })

  it('refuses an argument without asking Droid', async () => {
    expect(await runDroidChildCommand(CHAT, 'fork', 'a title')).toEqual({
      accepted: false,
      error: 'Use /fork without arguments.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('tells the person to update an older server that does not know the command', async () => {
    answers(Object.assign(new Error('Invalid params'), { code: 'invalid_argument' }))

    expect(await runDroidChildCommand(CHAT, 'fork', '')).toEqual({
      accepted: false,
      error: 'Droid chat commands need a newer Orca server. Update the server and try again.'
    })
  })

  it('leaves the other commands to say what their host said, whatever its code', async () => {
    answers(Object.assign(new Error('Invalid params'), { code: 'invalid_argument' }))

    expect(await runDroidChildCommand(CHAT, 'context', '')).toEqual({
      accepted: false,
      error: 'Invalid params'
    })
  })
})

describe('/rename in a Droid chat', () => {
  const RENAME = (title: string) => ({
    sessionId: 'session-1',
    command: { name: 'rename', title }
  })

  it("asks the chat's host to rename once, then gives the tab the title the person chose", async () => {
    answers({ name: 'rename', title: 'Fix the login redirect' })

    const outcome = await runDroidChildCommand(CHAT, 'rename', 'Fix the login redirect')

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(
      CHAT.target,
      'agentSession.droidCommand',
      RENAME('Fix the login redirect')
    )
    expect(renameTab).toHaveBeenCalledExactlyOnceWith('Fix the login redirect')
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: 'Renamed this chat to “Fix the login redirect”.'
    })
  })

  it('leaves the tab as it was until Droid has agreed to the rename', async () => {
    let agree: (result: DroidHostCommandResult) => void = () => {}
    mocks.call.mockReturnValue(new Promise((resolve) => (agree = resolve)))

    const running = runDroidChildCommand(CHAT, 'rename', 'Later')
    await flush()
    expect(renameTab).not.toHaveBeenCalled()

    agree({ name: 'rename', title: 'Later' })
    await running
    expect(renameTab).toHaveBeenCalledExactlyOnceWith('Later')
  })

  it('leaves the tab alone, and says what the host said, when Droid cannot rename', async () => {
    answers(new Error('Renaming the conversation needs a newer Droid. Update Droid and try again.'))

    expect(await runDroidChildCommand(CHAT, 'rename', 'Old Droid')).toEqual({
      accepted: false,
      error: 'Renaming the conversation needs a newer Droid. Update Droid and try again.'
    })
    expect(renameTab).not.toHaveBeenCalled()
  })

  it('sends the title as the tab will show it: on one line, without the spaces around it', async () => {
    answers({ name: 'rename', title: 'Fix the login redirect' })

    await runDroidChildCommand(CHAT, 'rename', '  Fix   the\tlogin\nredirect  ')

    expect(mocks.call.mock.calls[0]?.[2]).toEqual(RENAME('Fix the login redirect'))
  })

  it('gives the tab the title the host recorded, which is what the chat is named in Droid', async () => {
    answers({ name: 'rename', title: 'Fix the login' })

    await runDroidChildCommand(CHAT, 'rename', 'Fix the login redirect')

    expect(renameTab).toHaveBeenCalledExactlyOnceWith('Fix the login')
  })

  it.each([
    ['no title', ''],
    ['a title of only spaces', '   '],
    ['a title of only control characters', '\u0007\u200b']
  ])('says how to use it, without asking Droid, for %s', async (_label, argument) => {
    expect(await runDroidChildCommand(CHAT, 'rename', argument)).toEqual({
      accepted: false,
      error: 'Use /rename followed by a title, for example /rename Fix the login redirect.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
    expect(renameTab).not.toHaveBeenCalled()
  })

  it('refuses a title longer than a chat name can be, rather than cutting it', async () => {
    expect(await runDroidChildCommand(CHAT, 'rename', 'x'.repeat(201))).toEqual({
      accepted: false,
      error: 'Keep the /rename title under 200 characters.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
    expect(renameTab).not.toHaveBeenCalled()
  })

  it('measures the title as the tab will show it, not as it was typed', async () => {
    const spread = `Fix${' '.repeat(300)}the login`
    answers({ name: 'rename', title: 'Fix the login' })

    expect(await runDroidChildCommand(CHAT, 'rename', spread)).toMatchObject({ accepted: true })
    expect(mocks.call.mock.calls[0]?.[2]).toEqual(RENAME('Fix the login'))
  })

  it('takes a title of exactly the longest length', async () => {
    answers({ name: 'rename', title: 'x'.repeat(200) })

    expect(await runDroidChildCommand(CHAT, 'rename', 'x'.repeat(200))).toMatchObject({
      accepted: true
    })
    expect(renameTab).toHaveBeenCalledExactlyOnceWith('x'.repeat(200))
  })

  it('tells the person to update an older server that does not know the command', async () => {
    answers(Object.assign(new Error('Invalid params'), { code: 'invalid_argument' }))

    expect(await runDroidChildCommand(CHAT, 'rename', 'Old server')).toEqual({
      accepted: false,
      error: 'Droid chat commands need a newer Orca server. Update the server and try again.'
    })
    expect(renameTab).not.toHaveBeenCalled()
  })
})

describe('/rewind-conversation in a Droid chat', () => {
  it('runs the rewind the chat built, and asks the host for nothing itself', async () => {
    const outcome = { accepted: true, error: null }
    const rewindConversation = vi.fn(async () => outcome)

    expect(
      await runDroidChildCommand({ ...CHAT, rewindConversation }, 'rewind-conversation', '')
    ).toBe(outcome)

    expect(rewindConversation).toHaveBeenCalledOnce()
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('says so when the chat has no rewind to run', async () => {
    expect(await runDroidChildCommand(CHAT, 'rewind-conversation', '')).toEqual({
      accepted: false,
      error: 'This chat cannot rewind.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('refuses an argument without running the rewind', async () => {
    const rewindConversation = vi.fn(async () => ({ accepted: true, error: null }))

    expect(
      await runDroidChildCommand({ ...CHAT, rewindConversation }, 'rewind-conversation', 'now')
    ).toEqual({ accepted: false, error: 'Use /rewind-conversation without arguments.' })
    expect(rewindConversation).not.toHaveBeenCalled()
  })
})

describe('when the host cannot answer', () => {
  it.each(['context', 'cost', 'compress', 'fork'] as const)(
    "shows the host's own sentence for /%s",
    async (name) => {
      answers(
        new Error('Compacting the conversation needs a newer Droid. Update Droid and try again.')
      )

      expect(await runDroidChildCommand(CHAT, name, '')).toEqual({
        accepted: false,
        error: 'Compacting the conversation needs a newer Droid. Update Droid and try again.'
      })
    }
  )

  it.each([
    ['an empty message', Object.assign(new Error('x'), { message: '' })],
    ['only spaces', new Error('   ')]
  ])('falls back to a plain sentence when the error has %s', async (_label, error) => {
    answers(error)

    expect(await runDroidChildCommand(CHAT, 'context', '')).toEqual({
      accepted: false,
      error: 'Could not run /context. Try again.'
    })
  })

  it('lets /compress be tried again after a failure', async () => {
    answers(new Error('boom'))
    await runDroidChildCommand(CHAT, 'compress', '')
    answers({ name: 'compress', removedCount: 1, newSessionId: null })

    expect(await runDroidChildCommand(CHAT, 'compress', '')).toEqual({
      accepted: true,
      error: null
    })
  })
})
