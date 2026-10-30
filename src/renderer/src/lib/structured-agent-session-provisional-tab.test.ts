import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../shared/tab-types'
import type { AgentSessionLaunchPlan } from './agent-session-launch-plan'
import type { StructuredAgentLaunchSettlement } from './structured-agent-launch-settlement'

const mocks = vi.hoisted(() => ({
  createUnifiedTab: vi.fn(),
  createSupport: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      unifiedTabsByWorktree: {},
      activeGroupIdByWorktree: {},
      createUnifiedTab: mocks.createUnifiedTab,
      setActiveTabType: vi.fn()
    })
  }
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: (_target: unknown, method: string) =>
    method === 'agentSession.createSupport' ? mocks.createSupport() : new Promise(() => undefined)
}))

import {
  beginStructuredAgentSessionProvisionalLaunch,
  openStructuredAgentSessionProvisionalTab
} from './structured-agent-session-provisional-tab'

function planSettlingAs(settlement: StructuredAgentLaunchSettlement): AgentSessionLaunchPlan {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: begin() is the only member this path calls.
  return {
    route: 'structured-native-chat',
    agent: 'claude',
    worktreeId: 'wt-1',
    executionHostId: 'local',
    begin: () => ({
      sessionId: 'claude_1',
      executionHostId: 'local',
      settlement: Promise.resolve(settlement),
      cancel: vi.fn()
    }),
    launch: vi.fn()
  } as unknown as AgentSessionLaunchPlan
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createUnifiedTab.mockImplementation(
    (worktreeId: string, _type: string, tab: Partial<Tab>) => ({ ...tab, worktreeId })
  )
  mocks.createSupport.mockResolvedValue({ supported: true })
})

describe('a provisional structured chat tab', () => {
  it('opens once this machine admits the chat, in the caller group, on the host it was sent to', async () => {
    const launch = beginStructuredAgentSessionProvisionalLaunch({
      plan: planSettlingAs({ kind: 'structured', sessionId: 'claude_1' }),
      hooks: {},
      targetGroupId: 'group-2'
    })

    expect(launch?.tab).toBeNull()
    expect(mocks.createUnifiedTab).not.toHaveBeenCalled()
    await expect(launch?.settlement).resolves.toEqual({ kind: 'structured', sessionId: 'claude_1' })
    expect(mocks.createSupport).toHaveBeenCalledOnce()
    expect(mocks.createUnifiedTab).toHaveBeenCalledWith(
      'wt-1',
      'agent-session',
      expect.objectContaining({ executionHostId: 'local', targetGroupId: 'group-2' })
    )
  })

  it('opens another agent’s chat with exactly the tab fields it always had', () => {
    openStructuredAgentSessionProvisionalTab({
      worktreeId: 'wt-1',
      executionHostId: 'local',
      sessionId: 'claude_1',
      agent: 'claude'
    })

    const init: object = mocks.createUnifiedTab.mock.calls[0]?.[2]
    expect(Object.keys(init).sort()).toEqual([
      'activate',
      'agentSessionAgent',
      'entityId',
      'executionHostId',
      'id',
      'label'
    ])
  })

  it('places a chat after a given tab and carries its name, colour and pin', () => {
    openStructuredAgentSessionProvisionalTab({
      worktreeId: 'wt-1',
      executionHostId: 'local',
      sessionId: 'droid_2',
      agent: 'droid',
      placement: {
        afterTabId: 'agent-session:droid_1',
        customLabel: 'Fix auth',
        color: 'blue',
        isPinned: true
      }
    })

    expect(mocks.createUnifiedTab).toHaveBeenCalledWith(
      'wt-1',
      'agent-session',
      expect.objectContaining({
        afterTabId: 'agent-session:droid_1',
        customLabel: 'Fix auth',
        color: 'blue',
        isPinned: true
      })
    )
  })
})
