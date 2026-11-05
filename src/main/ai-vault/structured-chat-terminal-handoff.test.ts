import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { agentSessionConversationView } from '../../shared/agent-session/lifecycle/agent-session-conversation-view'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { structuredAgentRuntimeRegistration } from '../runtime/structured-agent-runtime-registrations'
import { prepareStructuredChatTerminalHandoff } from './structured-chat-terminal-handoff'
import type { AiVaultPrepareSessionResumeArgs } from '../../shared/ai-vault-resume-preparation'

let root: string | undefined
afterEach(async () => {
  setStructuredAgentSessionHost(null)
  vi.restoreAllMocks()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'droid-handoff-'))
  const filePath = join(root, 'saved.jsonl')
  await writeFile(filePath, '{"saved":true}\n')
  const record = agentSessionRecordFixture()
  record.provider = 'droid'
  record.accountHome = { variable: 'ORCA_DROID_ACCOUNT_HOME', path: root }
  record.providerHandleChain[0]!.handle = {
    transport: 'droid-stream-jsonrpc',
    agent: 'droid',
    nativeId: 'droid-original'
  }
  const work = { working: () => false, hasActionablePrompt: () => false }
  const close = vi.fn(async (_id: string, _cause: string, admit: () => boolean) => {
    if (!admit()) {
      throw new Error('refused')
    }
    record.lease = {
      ...record.lease,
      claimStatus: 'released',
      ownerProcess: null,
      reservedSpawnToken: null,
      deathEvidence: { kind: 'exit-observed', detail: 'closed', observedAt: 3_000 }
    }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only preparation dependencies are used.
  setStructuredAgentSessionHost({
    close,
    currentWork: () => work,
    journalSnapshot: async () => ({
      items: [
        {
          itemId: 'legacy:droid:droid-original:user-1',
          body: { kind: 'message', role: 'user' }
        }
      ],
      submissions: []
    }),
    deps: {
      adapter: {},
      store: {
        getRecord: () => record,
        getConversation: () => agentSessionConversationView(record),
        selectWritableRecord: () => ({ kind: 'writable', record }),
        requireWritableRecord: () => record
      },
      resolveWorkspacePath: async () => root,
      resolveLaunchEnv: () => ({})
    }
  } as never)
  vi.spyOn(
    structuredAgentRuntimeRegistration('droid')!.transcriptImport!,
    'findTranscript'
  ).mockResolvedValue(filePath)
  return { record, close, work, filePath }
}

const request = {
  sourceChat: { sessionId: 'session-alpha-1', workspaceId: 'workspace-1' },
  handoff: true
} as const

it('stops the chat before preparing a terminal resume of the original Droid conversation', async () => {
  const { close, filePath } = await fixture()
  const prepare = vi.fn(async (_args: AiVaultPrepareSessionResumeArgs) => {
    expect(close).toHaveBeenCalledTimes(1)
    return { useRealCodexHome: false }
  })
  const result = await prepareStructuredChatTerminalHandoff(request, prepare)
  expect(result.cliForkSource).toMatchObject({
    agent: 'droid',
    sessionId: 'droid-original',
    filePath,
    cwd: root
  })
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'droid-original' }))
  expect(prepare.mock.calls[0]?.[0]).not.toHaveProperty('fork')
})

it.each(['working', 'prompt', 'workspace', 'wsl', 'provider'] as const)(
  'keeps the chat open when the source is %s',
  async (reason) => {
    const { record, work, close } = await fixture()
    if (reason === 'working') {
      work.working = () => true
    }
    if (reason === 'prompt') {
      work.hasActionablePrompt = () => true
    }
    if (reason === 'workspace') {
      record.location.workspaceId = 'elsewhere'
    }
    if (reason === 'wsl') {
      record.location.wslDistro = 'Ubuntu'
    }
    if (reason === 'provider') {
      record.provider = 'claude'
    }
    const prepare = vi.fn()
    await expect(prepareStructuredChatTerminalHandoff(request, prepare)).rejects.toThrow()
    expect(close).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  }
)

it('refuses if close returns without proving process exit', async () => {
  const { close } = await fixture()
  close.mockImplementationOnce(async () => {})
  const prepare = vi.fn()
  await expect(prepareStructuredChatTerminalHandoff(request, prepare)).rejects.toThrow('exited')
  expect(prepare).not.toHaveBeenCalled()
})

it('rechecks work inside close admission after transcript resolution', async () => {
  const { work, close } = await fixture()
  vi.spyOn(
    structuredAgentRuntimeRegistration('droid')!.transcriptImport!,
    'findTranscript'
  ).mockImplementationOnce(async () => {
    work.working = () => true
    return join(root!, 'saved.jsonl')
  })
  const prepare = vi.fn()
  await expect(prepareStructuredChatTerminalHandoff(request, prepare)).rejects.toThrow('finish')
  expect(close).toHaveBeenCalledTimes(1)
  expect(prepare).not.toHaveBeenCalled()
})
