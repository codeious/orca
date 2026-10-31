// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type * as LaunchModule from '@/lib/launch-structured-agent-session'
import type * as RetirementModule from '@/runtime/structured-agent-session-tab-retirement'
import type { StructuredAgentSessionLaunchIntent } from '@/lib/launch-structured-agent-session'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Tab } from '../../../shared/tab-types'
import { DROID_SPEC_SAME_AS_MAIN } from '../../../shared/droid-spec-pair-options'
import { structuredAgentSessionTabId } from '../../../shared/structured-agent-session-projection'
import type { TabsSlice } from '../store/slices/tabs/tabs-slice-contract'
import { createTestStore } from '../store/slices/store-test-helpers'
import {
  clearStructuredAgentSessionPendingSends,
  getStructuredAgentSessionPendingSends
} from '@/components/native-chat/structured-agent-session-pending-sends'

type CallParams = { key?: string; value?: string }
type CreateIntent = (
  worktreeId: string,
  agent: string,
  executionHostId?: ExecutionHostId,
  resumeFrom?: { providerSessionId: string }
) => StructuredAgentSessionLaunchIntent

const mocks = vi.hoisted(() => {
  const store: { current: ReturnType<typeof createTestStore> | null } = { current: null }
  return {
    createIntent: vi.fn<CreateIntent>(),
    launch:
      vi.fn<(intent: { sessionId: string }) => Promise<{ sessionId: string; fence: number }>>(),
    call: vi.fn<(target: unknown, method: string, params: CallParams) => Promise<unknown>>(),
    beginClose: vi.fn(),
    inventory: vi.fn<() => Promise<unknown[]>>(),
    store
  }
})

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => {
      if (!mocks.store.current) {
        throw new Error('no test store')
      }
      return mocks.store.current.getState()
    },
    subscribe: () => () => {}
  }
}))
vi.mock('@/lib/launch-structured-agent-session', async (importOriginal) => ({
  ...(await importOriginal<typeof LaunchModule>()),
  createStructuredAgentSessionLaunchIntent: mocks.createIntent,
  launchStructuredAgentSession: mocks.launch
}))
vi.mock('@/runtime/structured-agent-session-tab-retirement', async (importOriginal) => ({
  ...(await importOriginal<typeof RetirementModule>()),
  beginStructuredAgentSessionTabClose: mocks.beginClose
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/runtime/structured-session-tab-inventory', () => ({
  readStructuredSessionTabInventory: mocks.inventory
}))

import { StructuredAgentSessionCreateRefusalError } from '@/lib/launch-structured-agent-session'
import { resetStructuredAgentLaunchPersistenceForTests } from './structured-agent-session-launch-persistence'
import { resetStructuredAgentLaunchRegistryForTests } from './structured-agent-session-launch-registry'
import { switchDroidChatSession } from './droid-chat-session-switch'

const WORKTREE = 'repo-1::/work/app'
const OLD_CHAT = 'droid-old'
const NEW_CHAT = 'droid-new'
const NEW_TAB = structuredAgentSessionTabId(NEW_CHAT)
const DROID_ID = '5d0f7c2e-3a41-4b8e-9c10-2f6a8e4b7d31'

let store: ReturnType<typeof createTestStore>

function chatIntent(
  worktreeId: string,
  agent: string,
  executionHostId: ExecutionHostId = 'local',
  resumeFrom?: { providerSessionId: string }
): StructuredAgentSessionLaunchIntent {
  const environmentId = executionHostId.startsWith('runtime:')
    ? executionHostId.slice('runtime:'.length)
    : null
  return {
    worktreeId,
    executionHostId,
    target: environmentId ? { kind: 'environment', environmentId } : { kind: 'local' },
    sessionId: NEW_CHAT,
    agent: 'droid',
    params: {
      envelope: {
        sessionId: NEW_CHAT,
        clientOperationId: 'operation-1',
        expectedRuntimeFence: null,
        payloadFingerprint: `fingerprint-${agent}`
      },
      worktree: `id:${worktreeId}`,
      agent: 'droid',
      ...(resumeFrom ? { resumeFrom } : {})
    }
  }
}

function openChat(
  id: string,
  agent: 'droid' | 'claude',
  init: Parameters<TabsSlice['createUnifiedTab']>[2] = {}
): Tab {
  return store.getState().createUnifiedTab(WORKTREE, 'agent-session', {
    id: `agent-session:${id}`,
    entityId: id,
    executionHostId: 'local',
    agentSessionAgent: agent,
    label: agent === 'droid' ? 'Droid Chat' : 'Claude Chat',
    ...init
  })
}

function tabIds(): string[] {
  const groupId = store.getState().groupsByWorktree[WORKTREE]?.[0]?.id
  return (
    store.getState().groupsByWorktree[WORKTREE]?.find((group) => group.id === groupId)?.tabOrder ??
    []
  )
}

function tab(id: string): Tab | undefined {
  return store.getState().unifiedTabsByWorktree[WORKTREE]?.find((candidate) => candidate.id === id)
}

/** What the switch asked for; the launch path appends a host-seed argument this test does not use. */
function intentRequest(): unknown[] | undefined {
  return mocks.createIntent.mock.calls[0]?.slice(0, 4)
}

function optionPicks(): [string | undefined, string | undefined][] {
  return mocks.call.mock.calls
    .filter(([, method]) => method === 'agentSession.setOption')
    .map(([, , params]) => [params.key, params.value])
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetStructuredAgentLaunchPersistenceForTests()
  resetStructuredAgentLaunchRegistryForTests()
  clearStructuredAgentSessionPendingSends(NEW_CHAT)
  store = createTestStore()
  mocks.store.current = store
  mocks.createIntent.mockImplementation(chatIntent)
  mocks.launch.mockResolvedValue({ sessionId: NEW_CHAT, fence: 4 })
  mocks.call.mockResolvedValue({ ok: true, value: { key: 'x', value: 'y' } })
  mocks.inventory.mockResolvedValue([
    { worktree: WORKTREE, tabs: [{ type: 'agent-session', sessionId: NEW_CHAT }] }
  ])
  openChat('claude-before', 'claude')
  openChat(OLD_CHAT, 'droid', { customLabel: 'Fix auth', color: 'blue', activate: true })
  openChat('claude-after', 'claude', { activate: false })
})

describe('switching a Droid chat to another Droid session', () => {
  it('replaces the tab in place, keeping its position and the name the user gave it', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })

    expect(switched.sessionId).toBe(NEW_CHAT)
    // Nothing is lost while the new session loads: the old tab stays until the new one is published.
    expect(tabIds()).toEqual([
      'agent-session:claude-before',
      `agent-session:${OLD_CHAT}`,
      NEW_TAB,
      'agent-session:claude-after'
    ])
    await expect(switched.settlement).resolves.toEqual({ kind: 'structured', sessionId: NEW_CHAT })

    expect(tabIds()).toEqual(['agent-session:claude-before', NEW_TAB, 'agent-session:claude-after'])
    expect(tab(NEW_TAB)).toMatchObject({
      entityId: NEW_CHAT,
      agentSessionAgent: 'droid',
      customLabel: 'Fix auth',
      color: 'blue',
      executionHostId: 'local'
    })
    expect(store.getState().groupsByWorktree[WORKTREE]?.[0]?.activeTabId).toBe(NEW_TAB)
  })

  it('keeps a title given with /rename, which sets the tab name as the tab strip does', async () => {
    store.getState().setTabCustomTitle(`agent-session:${OLD_CHAT}`, 'Chosen with /rename', {
      recordInteraction: false
    })
    expect(tab(`agent-session:${OLD_CHAT}`)?.customLabel).toBe('Chosen with /rename')

    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    await switched.settlement

    expect(tab(NEW_TAB)?.customLabel).toBe('Chosen with /rename')
  })

  it('leaves the old session in Session History by only releasing its view', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    await switched.settlement

    expect(mocks.beginClose).toHaveBeenCalledTimes(1)
    expect(mocks.beginClose).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: OLD_CHAT, worktreeId: WORKTREE, provisional: false })
    )
    expect(mocks.call.mock.calls.map(([, method]) => method)).not.toContain('agentSession.delete')
  })

  it('lands on the new chat when the user is back on the old tab as it closes', async () => {
    store.getState().activateTab('agent-session:claude-after')
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    store.getState().activateTab(`agent-session:${OLD_CHAT}`)
    await switched.settlement

    expect(store.getState().groupsByWorktree[WORKTREE]?.[0]?.activeTabId).toBe(NEW_TAB)
  })

  it('keeps the view the user moved to when the old tab is not in front as it closes', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    store.getState().activateTab('agent-session:claude-after')
    await switched.settlement

    expect(store.getState().groupsByWorktree[WORKTREE]?.[0]?.activeTabId).toBe(
      'agent-session:claude-after'
    )
    expect(tab(`agent-session:${OLD_CHAT}`)).toBeUndefined()
  })

  it('opens the new chat when the user closed the old tab while it loaded', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    store.getState().closeUnifiedTab(`agent-session:${OLD_CHAT}`)
    mocks.beginClose.mockClear()

    await expect(switched.settlement).resolves.toEqual({ kind: 'structured', sessionId: NEW_CHAT })

    expect(tab(NEW_TAB)).toBeDefined()
    expect(mocks.beginClose).not.toHaveBeenCalled()
  })

  it('keeps the old tab when the new session cannot be created', async () => {
    mocks.launch.mockRejectedValue(
      new StructuredAgentSessionCreateRefusalError('Droid could not load that session')
    )
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })

    await expect(switched.settlement).resolves.toMatchObject({ kind: 'failed' })

    expect(tab(`agent-session:${OLD_CHAT}`)).toBeDefined()
    expect(mocks.beginClose).not.toHaveBeenCalled()
  })

  it('opens a new tab beside the old one, which stays open and keeps its own name', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'beside',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    await expect(switched.settlement).resolves.toEqual({ kind: 'structured', sessionId: NEW_CHAT })

    expect(tabIds()).toEqual([
      'agent-session:claude-before',
      `agent-session:${OLD_CHAT}`,
      NEW_TAB,
      'agent-session:claude-after'
    ])
    expect(tab(`agent-session:${OLD_CHAT}`)?.customLabel).toBe('Fix auth')
    expect(tab(NEW_TAB)?.customLabel).toBeNull()
    expect(mocks.beginClose).not.toHaveBeenCalled()
  })

  it.each<[string, ExecutionHostId]>([
    ['this machine', 'local'],
    ['a guest runtime host', 'runtime:server-1']
  ])('creates the session on the same execution host as the tab: %s', async (_name, hostId) => {
    store.getState().closeUnifiedTab(`agent-session:${OLD_CHAT}`)
    mocks.beginClose.mockClear()
    openChat(OLD_CHAT, 'droid', { executionHostId: hostId })

    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    await switched.settlement

    expect(intentRequest()).toEqual([WORKTREE, 'droid', hostId, { providerSessionId: DROID_ID }])
    expect(tab(NEW_TAB)?.executionHostId).toBe(hostId)
  })

  it('adopts an existing Droid id as the resume identity, with no option sent to Droid', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: DROID_ID }
    })
    await switched.settlement

    expect(intentRequest()).toEqual([WORKTREE, 'droid', 'local', { providerSessionId: DROID_ID }])
    expect(optionPicks()).toEqual([])
  })

  it('starts a fresh session with the settings it is given, model before effort', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: {
        kind: 'fresh',
        settings: {
          autonomyLevel: 'low',
          specEffort: 'high',
          specModel: 'spec-model',
          spec: true,
          effort: 'medium',
          model: 'main-model'
        }
      }
    })
    await switched.settlement

    expect(intentRequest()).toEqual([WORKTREE, 'droid', 'local', undefined])
    expect(optionPicks()).toEqual([
      ['model', 'main-model'],
      ['effort', 'medium'],
      ['planMode', 'true'],
      ['specModel', 'spec-model'],
      ['specEffort', 'high'],
      ['autonomyLevel', 'low']
    ])
  })

  it('starts a /new session in Auto and leaves the rest to the new-chat defaults', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'fresh', settings: { spec: false } }
    })
    await switched.settlement

    expect(optionPicks()).toEqual([['planMode', 'false']])
  })

  it('can clear the Spec model on a fresh session', async () => {
    const switched = switchDroidChatSession({
      fromTabId: `agent-session:${OLD_CHAT}`,
      placement: 'replace',
      target: { kind: 'fresh', settings: { specModel: DROID_SPEC_SAME_AS_MAIN } }
    })
    await switched.settlement

    expect(optionPicks()).toEqual([['specModel', DROID_SPEC_SAME_AS_MAIN]])
  })

  describe('a carried pick the host refuses', () => {
    const REFUSED_PICK_NOTICE =
      "The setting wasn't changed. Orca on the computer running this chat has hit a request limit. Update Orca there, then try again."

    function refuseKey(key: string): void {
      mocks.call.mockImplementation(async (_target, _method, params) =>
        params.key === key
          ? {
              ok: false,
              refusal: { code: 'agent_session_operation_capacity', message: 'Not available' }
            }
          : { ok: true, value: { key: params.key, value: params.value } }
      )
    }

    it('is said once as the refused-option notice, and the new session still opens', async () => {
      refuseKey('effort')
      const switched = switchDroidChatSession({
        fromTabId: `agent-session:${OLD_CHAT}`,
        placement: 'replace',
        target: { kind: 'fresh', settings: { model: 'main-model', effort: 'xhigh', spec: true } }
      })

      const settled = await switched.settlement

      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSED_PICK_NOTICE))
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(settled.kind).toBe('structured')
      expect(tab(NEW_TAB)).toBeDefined()
    })

    it('is said for a session that resumes with settings too', async () => {
      refuseKey('autonomyLevel')
      const switched = switchDroidChatSession({
        fromTabId: `agent-session:${OLD_CHAT}`,
        placement: 'replace',
        target: { kind: 'existing', droidSessionId: DROID_ID, settings: { autonomyLevel: 'high' } }
      })

      await switched.settlement

      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSED_PICK_NOTICE))
    })

    it('stays silent when the host takes every carried pick', async () => {
      const switched = switchDroidChatSession({
        fromTabId: `agent-session:${OLD_CHAT}`,
        placement: 'replace',
        target: { kind: 'fresh', settings: { model: 'main-model', effort: 'low', spec: false } }
      })

      await switched.settlement
      await Promise.resolve()

      expect(optionPicks()).toHaveLength(3)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('with a first message and settings for an existing session', () => {
    const PLAN_PROMPT = `Implement the following plan:\n\n${'1. Write the file.\n'.repeat(900)}`

    const switchWith = (
      settings: { spec?: boolean; autonomyLevel?: string } | undefined,
      firstMessage: string | undefined
    ): ReturnType<typeof switchDroidChatSession> =>
      switchDroidChatSession({
        fromTabId: `agent-session:${OLD_CHAT}`,
        placement: 'replace',
        target: {
          kind: 'existing',
          droidSessionId: DROID_ID,
          ...(settings ? { settings } : {})
        },
        ...(firstMessage === undefined ? {} : { firstMessage })
      })

    it('holds the settings before the session is used, and sends the whole message once', async () => {
      const switched = switchWith({ spec: false, autonomyLevel: 'medium' }, PLAN_PROMPT)

      // Staged at the click, as the chat's one send, so nothing typed meanwhile goes ahead of it.
      expect(PLAN_PROMPT.length).toBeGreaterThan(16 * 1024)
      expect(getStructuredAgentSessionPendingSends(NEW_CHAT)).toMatchObject([
        { phase: 'sending', body: { blocks: [{ type: 'text', text: PLAN_PROMPT.trimEnd() }] } }
      ])
      await switched.settlement

      expect(intentRequest()).toEqual([WORKTREE, 'droid', 'local', { providerSessionId: DROID_ID }])
      expect(optionPicks()).toEqual([
        ['planMode', 'false'],
        ['autonomyLevel', 'medium']
      ])
      expect(mocks.launch).toHaveBeenCalledTimes(1)
      expect(getStructuredAgentSessionPendingSends(NEW_CHAT)).toHaveLength(1)
    })

    it('leaves the autonomy to the saved default when the option names no level', async () => {
      await switchWith({ spec: false }, PLAN_PROMPT).settlement

      expect(optionPicks()).toEqual([['planMode', 'false']])
    })

    it.each(['', '  \n'])('sends nothing for the message %j', async (blank) => {
      await switchWith(undefined, blank).settlement

      expect(getStructuredAgentSessionPendingSends(NEW_CHAT)).toHaveLength(0)
      expect(optionPicks()).toEqual([])
    })

    it('closes the old tab only after the new session is published', async () => {
      const switched = switchWith({ spec: false }, PLAN_PROMPT)

      expect(tabIds()).toContain(`agent-session:${OLD_CHAT}`)
      await switched.settlement

      expect(tabIds()).toEqual([
        'agent-session:claude-before',
        NEW_TAB,
        'agent-session:claude-after'
      ])
    })

    it('keeps the old tab when the new session cannot be loaded, and never sends into it', async () => {
      mocks.launch.mockRejectedValue(
        new StructuredAgentSessionCreateRefusalError('Droid could not load that session')
      )
      const switched = switchWith({ spec: false }, PLAN_PROMPT)

      await expect(switched.settlement).resolves.toMatchObject({ kind: 'failed' })

      expect(tab(`agent-session:${OLD_CHAT}`)).toBeDefined()
      expect(mocks.beginClose).not.toHaveBeenCalled()
      expect(getStructuredAgentSessionPendingSends(OLD_CHAT)).toHaveLength(0)
    })
  })

  it('refuses to start from a chat of another agent, and changes nothing', () => {
    const before = tabIds()

    expect(() =>
      switchDroidChatSession({
        fromTabId: 'agent-session:claude-before',
        placement: 'replace',
        target: { kind: 'existing', droidSessionId: DROID_ID }
      })
    ).toThrow('Droid chat')

    expect(mocks.createIntent).not.toHaveBeenCalled()
    expect(tabIds()).toEqual(before)
  })
})
