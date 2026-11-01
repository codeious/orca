import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DroidHostCommandResult } from '../../../../shared/droid-host-command'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/lib/droid-chat-session-switch', () => ({ switchDroidChatSession: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { runDroidChildCommand, type DroidChildCommandChat } from './droid-child-commands'

const CHAT: DroidChildCommandChat = {
  tabId: 'agent-session:droid-old',
  sessionId: 'session-1',
  target: { kind: 'environment', environmentId: 'env-1' },
  keptSettings: () => ({ model: 'claude-haiku-5-5', spec: false }),
  renameTab: vi.fn()
}

function answers(result: DroidHostCommandResult | Error): void {
  if (result instanceof Error) {
    mocks.call.mockRejectedValue(result)
  } else {
    mocks.call.mockResolvedValue(result)
  }
}

const asksHost = (command: unknown) =>
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
    sessionId: 'session-1',
    command
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(['cwd', 'cd'] as const)('/%s in a Droid chat', (name) => {
  it('asks the chat’s host to move Droid once, and says the folder Droid is in', async () => {
    answers({ name: 'cwd', resolvedPath: '/work/probe/packages/app' })

    const outcome = await runDroidChildCommand(CHAT, name, 'packages/app')

    asksHost({ name: 'cwd', path: 'packages/app' })
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: 'Working folder is now /work/probe/packages/app.'
    })
  })

  it('sends a folder with spaces in it whole', async () => {
    answers({ name: 'cwd', resolvedPath: '/work/probe/my folder' })

    await runDroidChildCommand(CHAT, name, '  my folder  ')

    asksHost({ name: 'cwd', path: 'my folder' })
  })

  it.each([
    ['no folder', ''],
    ['only spaces', '   ']
  ])('says how to use it, without asking the host, for %s', async (_label, argument) => {
    expect(await runDroidChildCommand(CHAT, name, argument)).toEqual({
      accepted: false,
      error: `Use /${name} followed by a folder inside this workspace, for example /${name} packages/app.`
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('refuses a folder longer than a path can be, without asking the host', async () => {
    expect(await runDroidChildCommand(CHAT, name, 'x'.repeat(4097))).toEqual({
      accepted: false,
      error: `Keep the /${name} folder under 4096 characters.`
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('shows the host’s own sentence when the folder is outside the workspace', async () => {
    answers(new Error('Choose a folder inside this workspace (/work/probe). /usr is outside it.'))

    expect(await runDroidChildCommand(CHAT, name, '/usr')).toEqual({
      accepted: false,
      error: 'Choose a folder inside this workspace (/work/probe). /usr is outside it.'
    })
  })

  it('shows Droid’s own sentence when it does not trust the folder', async () => {
    answers(
      new Error(
        'Folder is not trusted: /work/probe/sub. Open it in the Droid CLI and accept the trust prompt, then try again.'
      )
    )

    expect(await runDroidChildCommand(CHAT, name, 'sub')).toMatchObject({
      accepted: false,
      error: expect.stringContaining('Folder is not trusted')
    })
  })

  it('tells the person to update an older server that does not know the command', async () => {
    answers(Object.assign(new Error('Invalid params'), { code: 'invalid_argument' }))

    expect(await runDroidChildCommand(CHAT, name, 'sub')).toEqual({
      accepted: false,
      error: 'Droid chat commands need a newer Orca server. Update the server and try again.'
    })
  })
})

describe('/skills in a Droid chat', () => {
  const USAGE =
    'Use /skills to list skills, /skills disable <name> to turn one off, or /skills enable <name> to turn one on.'
  const HINT = 'Turn one off or on with /skills disable <name> or /skills enable <name>.'
  const listing = (...skills: [string, boolean][]): DroidHostCommandResult => ({
    name: 'skills',
    skills: skills.map(([skill, enabled]) => ({ name: skill, enabled })),
    changed: null
  })

  it.each(['', 'list'])('lists what is on and what is off, for “%s”', async (argument) => {
    answers(listing(['alpha', true], ['beta', true], ['gamma', false]))

    const outcome = await runDroidChildCommand(CHAT, 'skills', argument)

    asksHost({ name: 'skills' })
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: `Skills: 2 on, 1 off. On: alpha, beta. Off: gamma. ${HINT}`
    })
  })

  it('leaves out the side that has no skill', async () => {
    answers(listing(['alpha', true]))
    expect((await runDroidChildCommand(CHAT, 'skills', '')).info).toBe(
      `Skills: 1 on, 0 off. On: alpha. ${HINT}`
    )

    answers(listing(['gamma', false]))
    expect((await runDroidChildCommand(CHAT, 'skills', '')).info).toBe(
      `Skills: 0 on, 1 off. Off: gamma. ${HINT}`
    )
  })

  it('says so when Droid has no skills', async () => {
    answers(listing())

    expect(await runDroidChildCommand(CHAT, 'skills', '')).toEqual({
      accepted: true,
      error: null,
      info: 'Droid reports no skills.'
    })
  })

  it('asks the host to turn a skill off, and says how many are on after', async () => {
    answers({
      name: 'skills',
      skills: [
        { name: 'review', enabled: false },
        { name: 'wiki', enabled: true }
      ],
      changed: { skillName: 'review', disabled: true }
    })

    const outcome = await runDroidChildCommand(CHAT, 'skills', 'disable review')

    asksHost({ name: 'skills', toggle: { skillName: 'review', disabled: true } })
    expect(outcome).toEqual({
      accepted: true,
      error: null,
      info: 'Turned off the review skill. 1 of 2 skills are on.'
    })
  })

  it('asks the host to turn a skill back on', async () => {
    answers({
      name: 'skills',
      skills: [
        { name: 'review', enabled: true },
        { name: 'wiki', enabled: true }
      ],
      changed: { skillName: 'review', disabled: false }
    })

    const outcome = await runDroidChildCommand(CHAT, 'skills', 'ENABLE review')

    asksHost({ name: 'skills', toggle: { skillName: 'review', disabled: false } })
    expect(outcome.info).toBe('Turned on the review skill. 2 of 2 skills are on.')
  })

  it.each([
    ['a word that is not a verb', 'foo'],
    ['a verb with no skill', 'disable'],
    ['a verb with two skills', 'enable review wiki'],
    ['the list with something after it', 'list review'],
    ['a skill name longer than one can be', `disable ${'x'.repeat(201)}`]
  ])('says how to use it, without asking the host, for %s', async (_label, argument) => {
    expect(await runDroidChildCommand(CHAT, 'skills', argument)).toEqual({
      accepted: false,
      error: USAGE
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('shows the host’s own sentence when Droid has no such skill', async () => {
    answers(new Error('Droid has no skill named nope.'))

    expect(await runDroidChildCommand(CHAT, 'skills', 'disable nope')).toEqual({
      accepted: false,
      error: 'Droid has no skill named nope.'
    })
  })

  it('tells the person to update an older server that does not know the command', async () => {
    answers(Object.assign(new Error('Invalid params'), { code: 'invalid_argument' }))

    expect(await runDroidChildCommand(CHAT, 'skills', '')).toEqual({
      accepted: false,
      error: 'Droid chat commands need a newer Orca server. Update the server and try again.'
    })
  })
})
