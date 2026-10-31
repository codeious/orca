import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_MCP_ARGS_MAX,
  DROID_MCP_ARG_MAX_LENGTH,
  DROID_MCP_NAME_MAX_LENGTH,
  DROID_MCP_TARGET_MAX_LENGTH,
  type DroidHostCommandResult
} from '../../../../shared/droid-host-command'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/lib/droid-chat-session-switch', () => ({ switchDroidChatSession: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { mcpHostCommand, mcpRefusal, mcpWords } from './droid-mcp-commands'
import { runDroidChildCommand, type DroidChildCommandChat } from './droid-child-commands'

const CHAT: DroidChildCommandChat = {
  tabId: 'agent-session:droid-old',
  sessionId: 'session-1',
  target: { kind: 'environment', environmentId: 'env-1' },
  keptSettings: () => ({ model: 'claude-haiku-5-5', spec: false }),
  renameTab: vi.fn()
}

type McpResult = Extract<DroidHostCommandResult, { name: 'mcp' }>

const LOCAL = { name: 'parmcp-local', status: 'failed', type: 'stdio', toolCount: null } as const
const REMOTE = {
  name: 'docs',
  status: 'connected',
  type: 'http',
  toolCount: 12,
  needsSignIn: false
} as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('what /mcp asks', () => {
  it.each([
    ['', { kind: 'list' }],
    ['  ', { kind: 'list' }],
    ['list', { kind: 'list' }],
    ['LIST', { kind: 'list' }],
    ['enable docs', { kind: 'toggle', serverName: 'docs', enabled: true }],
    ['disable docs', { kind: 'toggle', serverName: 'docs', enabled: false }],
    ['remove docs', { kind: 'remove', serverName: 'docs' }],
    ['signin docs', { kind: 'sign-in', serverName: 'docs' }],
    ['sign-in docs', { kind: 'sign-in', serverName: 'docs' }],
    [
      'add local /work/probe/mcp-server.sh',
      {
        kind: 'add',
        serverName: 'local',
        server: { type: 'stdio', command: '/work/probe/mcp-server.sh', args: [] }
      }
    ],
    [
      'add local node server.js --port 80',
      {
        kind: 'add',
        serverName: 'local',
        server: { type: 'stdio', command: 'node', args: ['server.js', '--port', '80'] }
      }
    ],
    [
      'add local "/work/my tools/run.sh" \'two words\'',
      {
        kind: 'add',
        serverName: 'local',
        server: { type: 'stdio', command: '/work/my tools/run.sh', args: ['two words'] }
      }
    ],
    [
      'add docs http https://mcp.example.invalid/mcp',
      {
        kind: 'add',
        serverName: 'docs',
        server: { type: 'http', url: 'https://mcp.example.invalid/mcp' }
      }
    ],
    [
      'add docs SSE http://localhost:8080/sse',
      { kind: 'add', serverName: 'docs', server: { type: 'sse', url: 'http://localhost:8080/sse' } }
    ]
  ])('reads “/mcp %s”', (argument, action) => {
    expect(mcpHostCommand(argument)).toEqual({ name: 'mcp', action })
    expect(mcpRefusal(argument)).toBeNull()
  })

  it.each([
    ['an unknown word', 'restart docs'],
    ['a list with a name', 'list docs'],
    ['an enable with no name', 'enable'],
    ['a disable with two names', 'disable docs more'],
    ['a remove with no name', 'remove'],
    ['a sign-in with no name', 'signin'],
    ['an add with no command', 'add local'],
    ['an add with nothing', 'add'],
    ['a remote add with no address', 'add docs http'],
    ['a remote add with an address that is not a web address', 'add docs http ftp://x.invalid/a'],
    ['a remote add with two addresses', 'add docs sse https://a.invalid https://b.invalid']
  ])('turns away %s', (_label, argument) => {
    expect(mcpHostCommand(argument)).toBeNull()
    expect(mcpRefusal(argument)).toBe(
      'Use /mcp to list MCP servers, or /mcp add <name> <command> [arguments], /mcp add <name> http <address>, /mcp enable <name>, /mcp disable <name>, /mcp remove <name> or /mcp signin <name>.'
    )
  })

  it.each([
    ['a server name', `enable ${'n'.repeat(DROID_MCP_NAME_MAX_LENGTH + 1)}`],
    ['an add name', `add ${'n'.repeat(DROID_MCP_NAME_MAX_LENGTH + 1)} run.sh`],
    ['a command', `add local ${'c'.repeat(DROID_MCP_TARGET_MAX_LENGTH + 1)}`],
    ['an argument', `add local run.sh ${'a'.repeat(DROID_MCP_ARG_MAX_LENGTH + 1)}`],
    ['the number of arguments', `add local run.sh ${'a '.repeat(DROID_MCP_ARGS_MAX + 1)}`]
  ])('turns away %s that is too long, without asking Droid', async (_label, argument) => {
    expect(mcpHostCommand(argument)).toBeNull()
    expect(await runDroidChildCommand(CHAT, 'mcp', argument)).toEqual({
      accepted: false,
      error:
        'Use /mcp to list MCP servers, or /mcp add <name> <command> [arguments], /mcp add <name> http <address>, /mcp enable <name>, /mcp disable <name>, /mcp remove <name> or /mcp signin <name>.'
    })
    expect(mocks.call).not.toHaveBeenCalled()
  })
})

describe('what /mcp says', () => {
  it('lists each server with its kind and state, and how to change one', () => {
    const result: McpResult = {
      name: 'mcp',
      servers: [
        { ...LOCAL, needsSignIn: false },
        REMOTE,
        { name: 'crm', status: 'disconnected', type: 'sse', toolCount: null, needsSignIn: true }
      ],
      changed: null
    }

    expect(mcpWords(result)).toBe(
      'MCP servers: parmcp-local (stdio, failed); docs (http, connected, 12 tools); crm (sse, disconnected, needs sign-in). Change one with /mcp add, /mcp remove, /mcp disable, /mcp enable or /mcp signin <name>.'
    )
  })

  it('says a single tool in the singular', () => {
    const result: McpResult = {
      name: 'mcp',
      servers: [{ ...REMOTE, toolCount: 1 }],
      changed: null
    }

    expect(mcpWords(result)).toContain('docs (http, connected, 1 tool)')
  })

  it('says there are none, and how to add one', () => {
    expect(mcpWords({ name: 'mcp', servers: [], changed: null })).toBe(
      'No MCP servers are set up. Add one with /mcp add <name> <command>.'
    )
  })

  it.each([
    ['added', 'Added the parmcp-local MCP server.'],
    ['enabled', 'Turned on the parmcp-local MCP server.'],
    ['disabled', 'Turned off the parmcp-local MCP server.'],
    ['removed', 'Removed the parmcp-local MCP server.'],
    ['signed-in', 'Signed in to the parmcp-local MCP server.']
  ] as const)('opens with what was %s, then lists what Droid now holds', (kind, sentence) => {
    const result: McpResult = {
      name: 'mcp',
      servers: [{ ...LOCAL, needsSignIn: false }],
      changed: { kind, serverName: 'parmcp-local' }
    }

    expect(mcpWords(result)).toBe(`${sentence} MCP servers: parmcp-local (stdio, failed).`)
  })
})

describe('/mcp in a Droid chat', () => {
  it("asks the chat's host once and says what Droid listed", async () => {
    mocks.call.mockResolvedValue({
      name: 'mcp',
      servers: [{ ...REMOTE }],
      changed: null
    } satisfies McpResult)

    const outcome = await runDroidChildCommand(CHAT, 'mcp', '')

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
      sessionId: 'session-1',
      command: { name: 'mcp', action: { kind: 'list' } }
    })
    expect(outcome).toMatchObject({ accepted: true, error: null })
    expect(outcome.info).toContain('docs (http, connected, 12 tools)')
  })

  it('sends an add as the person typed it', async () => {
    mocks.call.mockResolvedValue({
      name: 'mcp',
      servers: [{ ...LOCAL, needsSignIn: false }],
      changed: { kind: 'added', serverName: 'parmcp-local' }
    } satisfies McpResult)

    const outcome = await runDroidChildCommand(
      CHAT,
      'mcp',
      'add parmcp-local /work/probe/run.sh -q'
    )

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(CHAT.target, 'agentSession.droidCommand', {
      sessionId: 'session-1',
      command: {
        name: 'mcp',
        action: {
          kind: 'add',
          serverName: 'parmcp-local',
          server: { type: 'stdio', command: '/work/probe/run.sh', args: ['-q'] }
        }
      }
    })
    expect(outcome.info?.startsWith('Added the parmcp-local MCP server.')).toBe(true)
  })

  it('shows no address in the card for a remote add', async () => {
    mocks.call.mockResolvedValue({
      name: 'mcp',
      servers: [{ ...REMOTE }],
      changed: { kind: 'added', serverName: 'docs' }
    } satisfies McpResult)

    const outcome = await runDroidChildCommand(
      CHAT,
      'mcp',
      'add docs http https://mcp.example.invalid/mcp'
    )

    expect(outcome.info?.includes('mcp.example.invalid')).toBe(false)
  })

  it('says what the host said when it refuses, as for the other commands', async () => {
    mocks.call.mockRejectedValue(new Error('Droid has no MCP server named nope.'))

    expect(await runDroidChildCommand(CHAT, 'mcp', 'remove nope')).toEqual({
      accepted: false,
      error: 'Droid has no MCP server named nope.'
    })
  })

  it('tells the person to update an older server that does not know the command', async () => {
    mocks.call.mockRejectedValue(
      Object.assign(new Error('Invalid params'), { code: 'invalid_argument' })
    )

    expect(await runDroidChildCommand(CHAT, 'mcp', '')).toEqual({
      accepted: false,
      error: 'Droid chat commands need a newer Orca server. Update the server and try again.'
    })
  })
})
