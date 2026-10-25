// Resume in new chat, Droid: the create RPC opens a chat whose history is the Droid session file,
// whose Droid launch loads that same conversation, and which no second chat can also adopt.

import '../unused-default-rpc-methods.test-fixture'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session-mutation-envelope'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { DROID_AGENT } from '../../../droid/droid-agent-definition'
import {
  createDroidLaunchResolver,
  droidProviderLink
} from '../../../droid/droid-structured-launch-resolution'
import { openTestJournalHostDatabase } from '../../../native-chat/agent-session-journal/journal-host-database-test-support'
import type { StructuredAgentSessionAdapter } from '../../../native-chat/agent-session-wire/structured-agent-session-adapter'
import { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { createStructuredAgentSessionLogger } from '../../../native-chat/agent-session-wire/structured-agent-session-logger'
import { StructuredAgentRegistry } from '../../../native-chat/agent-session-wire/structured-agent-registry'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { openTestAgentSessionRecordStore } from '../../agent-session-record-store-test-harness'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  DROID_REASONING_TEXT,
  DROID_REPLY_TEXT,
  DROID_SESSION,
  DROID_USER_TEXT,
  DROID_WORKSPACE,
  droidRuntimeAt,
  localLocation,
  writeDroidSession
} from '../../structured-agent-session-droid-adoption.test-support'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { STRUCTURED_AGENT_SESSION_METHODS } from './structured-agent-session'

const CHAT = 'chat-droid-adoption'
const NOW = 1_800_000_000_000
const CLIENT = {
  clientId: 'device-a',
  clientKind: 'runtime' as const,
  clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
}

let root: string
let home: string
let host: StructuredAgentSessionHost | undefined
let opened: string[]
let operations: number

function nextOperation(): string {
  return `${Date.now()}-${String(++operations).padStart(32, '0')}`
}

function createParams(sessionId = CHAT, operationId = nextOperation()) {
  const fields = {
    worktree: `id:${DROID_WORKSPACE}`,
    agent: 'droid' as const,
    resumeFrom: { providerSessionId: DROID_SESSION }
  }
  return {
    envelope: {
      sessionId,
      clientOperationId: operationId,
      expectedRuntimeFence: null,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.create',
        sessionId,
        fields
      })
    },
    ...fields
  }
}

async function call(dispatcher: RpcDispatcher, params: unknown): Promise<RpcResponse> {
  const replies: RpcResponse[] = []
  const request: RpcRequest = {
    id: 'request-1',
    authToken: 'token',
    method: 'agentSession.create',
    params
  }
  await dispatcher.dispatchStreaming(
    request,
    (raw) => replies.push(JSON.parse(raw) as RpcResponse),
    CLIENT
  )
  return replies[0]
}

/** Droid's launch as the real adapter reads it: the resolver over the host's own record, and the
 *  conversation it would load recorded for the test. */
function droidAdapter(
  resolveLaunch: ReturnType<typeof createDroidLaunchResolver>,
  loaded: (string | null)[]
): StructuredAgentSessionAdapter {
  return {
    supportsCreate: () => true,
    acquire: vi
      .fn<StructuredAgentSessionAdapter['acquire']>()
      .mockImplementation(async ({ identity, fence, spawnToken }) => {
        const launch = await resolveLaunch(identity)
        loaded.push(launch.previous?.handle.nativeId ?? null)
        return {
          process: { hostId: 'local', pid: 4242, processStartTimeMs: NOW, spawnToken },
          link: droidProviderLink(launch, DROID_SESSION, fence, `droid-link-${fence}`, NOW)
        }
      }),
    releaseAcquisition: vi.fn(async () => true),
    dispatch: vi.fn(),
    cancelTurn: vi.fn(),
    answerPrompt: vi.fn(),
    setOption: vi.fn()
  }
}

async function openRig(publishTab: () => Promise<void> = async () => undefined) {
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const runtime: OrcaRuntimeService = droidRuntimeAt(localLocation())
  // The structured surface is settings-gated for every caller, so the gate has to admit the call.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The RPC gate reads only this setting from the test double.
  vi.spyOn(runtime, 'getClientSettings').mockReturnValue({
    experimentalNativeChat: true
  } as ReturnType<OrcaRuntimeService['getClientSettings']>)
  const internal = runtime as unknown as {
    resolveRuntimeFileTarget: () => Promise<{ worktree: { path: string } }>
    ensureStructuredAgentSessionHost: () => Promise<void>
    publishStructuredAgentSessionTab: () => Promise<void>
  }
  internal.resolveRuntimeFileTarget = vi.fn(async () => ({ worktree: { path: workspace } }))
  internal.publishStructuredAgentSessionTab = vi.fn(publishTab)

  const store = await openTestAgentSessionRecordStore(root)
  const loaded: (string | null)[] = []
  const adapter = droidAdapter(
    createDroidLaunchResolver({
      store,
      resolveWorkspacePath: async () => workspace,
      resolveEnvironment: async () => ({ PATH: '/host/bin', HOME: '/host/home' }),
      resolveLaunchArgs: () => [],
      resolveCommand: () => '/host/bin/droid',
      readVersion: async () => '0.249.0',
      orcaEnv: {}
    }),
    loaded
  )
  host = new StructuredAgentSessionHost({
    agents: new StructuredAgentRegistry([{ definition: DROID_AGENT, adapter }]),
    logger: createStructuredAgentSessionLogger(),
    store,
    adapter,
    journalDatabase: openTestJournalHostDatabase(root),
    claimKeyId: 'key-1'
  })
  const bound = host
  setStructuredAgentSessionHost(bound)
  internal.ensureStructuredAgentSessionHost = vi.fn(async () =>
    setStructuredAgentSessionHost(bound)
  )
  const dispatcher = new RpcDispatcher({ runtime, methods: STRUCTURED_AGENT_SESSION_METHODS })
  return { store, adapter, loaded, internal, dispatcher }
}

function pageText(response: RpcResponse): string {
  return JSON.stringify((response as { result: { value: { page: unknown } } }).result.value.page)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-droid-adoption-rpc-'))
  home = join(root, 'home')
  await mkdir(home, { recursive: true })
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('ORCA_USER_DATA_PATH', join(root, 'user-data'))
  opened = [CHAT]
  operations = 0
})

afterEach(async () => {
  setStructuredAgentSessionHost(null)
  await host?.flushAllStreamedEvents()
  for (const sessionId of opened) {
    await host?.close(sessionId, 'evict')
  }
  host = undefined
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Resume in new chat for a Droid session, through the create RPC', () => {
  it('opens with the session history and makes Droid load that same conversation', async () => {
    await writeDroidSession(home)
    const { dispatcher, loaded, store, adapter } = await openRig()

    const response = await call(dispatcher, createParams())

    expect(response).toMatchObject({ ok: true, result: { ok: true } })
    const text = pageText(response)
    expect(text).toContain(DROID_USER_TEXT)
    expect(text).toContain(DROID_REPLY_TEXT)
    expect(text).not.toContain(DROID_REASONING_TEXT)
    expect(loaded).toEqual([DROID_SESSION])
    expect(adapter.acquire).toHaveBeenCalledTimes(1)
    // Droid proving the same id at the same fence is a retry, so the chain stays the one adopted
    // conversation; a Droid that started a fresh session would show here as a second root.
    expect(
      store.getRecord(CHAT)?.providerHandleChain.map((link) => [link.origin, link.handle.nativeId])
    ).toEqual([['adopted', DROID_SESSION]])
  })

  it('replays from durable identity after the session file is gone', async () => {
    const file = await writeDroidSession(home)
    const { dispatcher, loaded, adapter, internal } = await openRig(
      vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('simulated lost tab publication'))
        .mockResolvedValue(undefined)
    )
    const params = createParams()

    expect(await call(dispatcher, params)).toMatchObject({
      ok: true,
      result: { ok: false, refusal: { code: 'agent_session_operation_unknown' } }
    })
    await rm(file)
    setStructuredAgentSessionHost(null)

    const replay = await call(dispatcher, params)

    expect(replay).toMatchObject({ ok: true, result: { ok: true, replayed: true } })
    expect(pageText(replay)).toContain(DROID_USER_TEXT)
    expect(loaded).toEqual([DROID_SESSION])
    expect(adapter.acquire).toHaveBeenCalledTimes(1)
    expect(internal.publishStructuredAgentSessionTab).toHaveBeenCalledTimes(2)
  })

  it('refuses a second chat adopting a conversation the first one holds', async () => {
    await writeDroidSession(home)
    const { dispatcher, loaded, adapter } = await openRig()
    expect(await call(dispatcher, createParams())).toMatchObject({ result: { ok: true } })
    opened.push('chat-second-writer')

    const second = await call(dispatcher, createParams('chat-second-writer'))

    expect(second).toMatchObject({
      ok: true,
      result: {
        ok: false,
        refusal: {
          code: 'agent_session_conflict',
          details: { reason: 'conversationHeldElsewhere' }
        }
      }
    })
    expect(adapter.acquire).toHaveBeenCalledTimes(1)
    expect(loaded).toEqual([DROID_SESSION])
  })
})
