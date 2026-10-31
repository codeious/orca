import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  SESSION,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'

beforeEach(() => {
  installStructuredHostStub()
  // The shared stub is at its line limit; this method is the only one that reads this call.
  hostCalls.droidCommand = vi.fn(async () => ({ name: 'credits', factoryCredits: null }))
})

afterEach(() => {
  clearStructuredHostStub()
})

describe('agentSession.droidCommand', () => {
  it.each([
    [{ name: 'context' }],
    [{ name: 'credits' }],
    [{ name: 'compress' }],
    [{ name: 'compress', instructions: 'keep the schema' }],
    [{ name: 'fork' }],
    [{ name: 'rename', title: 'Fix the login redirect' }],
    [{ name: 'cwd', path: 'packages/app' }],
    [{ name: 'skills' }],
    [{ name: 'skills', toggle: { skillName: 'review', disabled: true } }],
    [{ name: 'skills', toggle: { skillName: 'review', disabled: false } }],
    [{ name: 'mcp', action: { kind: 'list' } }],
    [
      {
        name: 'mcp',
        action: {
          kind: 'add',
          serverName: 'local',
          server: { type: 'stdio', command: '/work/run.sh', args: ['-q'] }
        }
      }
    ],
    [
      {
        name: 'mcp',
        action: {
          kind: 'add',
          serverName: 'docs',
          server: { type: 'sse', url: 'https://a.invalid/s' }
        }
      }
    ],
    [{ name: 'mcp', action: { kind: 'toggle', serverName: 'docs', enabled: false } }],
    [{ name: 'mcp', action: { kind: 'remove', serverName: 'docs' } }],
    [{ name: 'mcp', action: { kind: 'sign-in', serverName: 'docs' } }],
    [{ name: 'rewind', itemId: 'droid:message-1' }]
  ])('hands %j to the host for the session and answers with its result', async (command) => {
    hostCalls.droidCommand.mockResolvedValueOnce({ name: 'credits', factoryCredits: 12 })

    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command },
      STRUCTURED_CLIENT
    )

    expect(hostCalls.droidCommand).toHaveBeenCalledWith(SESSION, command)
    expect(response).toMatchObject({ ok: true, result: { name: 'credits', factoryCredits: 12 } })
  })

  it.each([
    ['a command Droid chat does not have', { name: 'cost' }],
    ['a key it does not know', { name: 'context', verbose: true }],
    ['instructions on a command that takes none', { name: 'credits', instructions: 'x' }],
    ['an empty command', {}],
    ['a title for the fork, which the host words itself', { name: 'fork', title: 'x' }],
    ['a rename that names no title', { name: 'rename' }],
    ['a rename to an empty title', { name: 'rename', title: '' }],
    ['a rename to a title longer than a name can be', { name: 'rename', title: 'x'.repeat(201) }],
    ['a rename to a title that is not text', { name: 'rename', title: 7 }],
    ['a key beside the rename title', { name: 'rename', title: 'x', force: true }],
    ['the /cd spelling, which the client sends as cwd', { name: 'cd', path: 'sub' }],
    ['a cwd that names no folder', { name: 'cwd' }],
    ['a cwd to an empty folder', { name: 'cwd', path: '' }],
    ['a cwd folder that is not text', { name: 'cwd', path: 7 }],
    ['a cwd folder longer than a path can be', { name: 'cwd', path: 'x'.repeat(4097) }],
    ['a key beside the cwd folder', { name: 'cwd', path: 'sub', force: true }],
    ['a key beside skills', { name: 'skills', all: true }],
    ['a skills toggle that names no skill', { name: 'skills', toggle: { disabled: true } }],
    [
      'a skills toggle of an empty skill name',
      { name: 'skills', toggle: { skillName: '', disabled: true } }
    ],
    [
      'a skills toggle that says nothing about on or off',
      { name: 'skills', toggle: { skillName: 'review' } }
    ],
    [
      'a skills toggle whose on or off is not a boolean',
      { name: 'skills', toggle: { skillName: 'review', disabled: 'yes' } }
    ],
    [
      'a key beside the skills toggle, such as a settings level',
      { name: 'skills', toggle: { skillName: 'review', disabled: true, settingsLevel: 'project' } }
    ],
    ['an mcp that names no action', { name: 'mcp' }],
    [
      'an mcp action of an unknown kind',
      { name: 'mcp', action: { kind: 'restart', serverName: 'a' } }
    ],
    ['an mcp remove that names no server', { name: 'mcp', action: { kind: 'remove' } }],
    [
      'an mcp remove of an empty server name',
      { name: 'mcp', action: { kind: 'remove', serverName: '' } }
    ],
    [
      'an mcp server name longer than a name can be',
      { name: 'mcp', action: { kind: 'remove', serverName: 'x'.repeat(201) } }
    ],
    [
      'an mcp toggle whose on or off is not a boolean',
      { name: 'mcp', action: { kind: 'toggle', serverName: 'a', enabled: 'yes' } }
    ],
    [
      'a key beside an mcp sign-in, such as a link or a code',
      { name: 'mcp', action: { kind: 'sign-in', serverName: 'a', authUrl: 'https://a.invalid' } }
    ],
    [
      'an mcp add of a server kind Droid does not have',
      {
        name: 'mcp',
        action: {
          kind: 'add',
          serverName: 'a',
          server: { type: 'websocket', url: 'wss://a.invalid' }
        }
      }
    ],
    [
      'an mcp stdio add with a command that is not text',
      {
        name: 'mcp',
        action: { kind: 'add', serverName: 'a', server: { type: 'stdio', command: 7, args: [] } }
      }
    ],
    [
      'an mcp stdio add with more arguments than are allowed',
      {
        name: 'mcp',
        action: {
          kind: 'add',
          serverName: 'a',
          server: { type: 'stdio', command: 'run', args: Array.from({ length: 65 }, () => 'x') }
        }
      }
    ],
    ['a key beside mcp', { name: 'mcp', action: { kind: 'list' }, env: { TOKEN: 'x' } }],
    ['a rewind that names no row', { name: 'rewind' }],
    ['a rewind to an empty row id', { name: 'rewind', itemId: '' }],
    ['a rewind that names the Droid message itself', { name: 'rewind', messageId: 'droid-1' }]
  ])('refuses %s before reaching the host', async (_label, command) => {
    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command },
      STRUCTURED_CLIENT
    )

    expect(response).toMatchObject({ ok: false })
    expect(hostCalls.droidCommand).not.toHaveBeenCalled()
  })

  it('refuses a key beside the session and command', async () => {
    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command: { name: 'context' }, fence: 3 },
      STRUCTURED_CLIENT
    )

    expect(response).toMatchObject({ ok: false })
    expect(hostCalls.droidCommand).not.toHaveBeenCalled()
  })

  it('refuses a client that never negotiated structured sessions', async () => {
    const response = await call(
      'agentSession.droidCommand',
      { sessionId: SESSION, command: { name: 'context' } },
      { clientKind: 'runtime', clientCapabilities: [] }
    )

    expect(response).toMatchObject({ ok: false })
    expect(hostCalls.droidCommand).not.toHaveBeenCalled()
  })
})
