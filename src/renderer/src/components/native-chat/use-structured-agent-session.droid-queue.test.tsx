// @vitest-environment happy-dom

// The shared held-follow-up card is for Claude, Codex, pi and the ACP agents (grok, opencode, omp);
// NativeChatQueuedMessageList.test.tsx pins its Steer, Edit and Delete actions. Droid takes a
// mid-turn message at once (Enter steers, Ctrl+Enter waits), so its queue stays off with the setting on.

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import type { AgentSessionQueuedMessage } from '../../../../shared/agent-session-wire'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  sendArgs: Array.of<{ queue?: { capability: string; enabled: boolean } }>()
}))
let items: AgentJournalRenderItem[] = []
let queuedMessages: AgentSessionQueuedMessage[] | undefined

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call,
  supportsStructuredAgentSessionPromptCancel: vi.fn(async () => false)
}))

vi.mock('./use-structured-agent-session-read', () => ({
  useStructuredAgentSessionRead: () => ({
    state: {
      fence: 3,
      items,
      submissions: [],
      status: 'ready',
      error: null,
      hasOlder: false,
      ...(queuedMessages !== undefined ? { queuedMessages, nextQueuedMessageId: null } : {})
    },
    loadingOlder: false,
    loadOlder: vi.fn()
  })
}))

vi.mock('./use-structured-agent-session-sends', () => ({
  useStructuredAgentSessionSends: (args: { queue?: { capability: string; enabled: boolean } }) => {
    mocks.sendArgs.push(args)
    return { pending: [], error: null, send: vi.fn(), stopSends: vi.fn() }
  }
}))

import {
  AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY,
  AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/local-runtime-capabilities'
import { clearNativeChatDraftCacheForTests } from './native-chat-draft-cache'
import { useStructuredAgentSession } from './use-structured-agent-session'
import { nativeChatStructuredStopControls } from './native-chat-structured-stop-controls'

const RUNNING_TURN: AgentJournalRenderItem = {
  itemId: 'turn-1',
  revision: 1,
  sequence: 1,
  observedAt: 1,
  body: { kind: 'turn', turnId: 'provider-turn', state: 'running' }
}

function render(agent: AgentType, queueFollowUps = true) {
  return renderHook(() =>
    useStructuredAgentSession({
      sessionId: 'session-1',
      agent,
      target: { kind: 'local' },
      isVisible: true,
      composerScopeKey: 'scope-1',
      queueFollowUps
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sendArgs.length = 0
  mocks.call.mockResolvedValue(null)
  items = [RUNNING_TURN]
  queuedMessages = undefined
  localStorage.clear()
  clearNativeChatDraftCacheForTests()
  setLocalRuntimeCapabilitiesForTests([
    AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY,
    AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY
  ])
})

afterEach(() => {
  setLocalRuntimeCapabilitiesForTests(null)
})

describe('with the Queue follow-ups setting on and a host that queues', () => {
  it.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'] as const)(
    '%s keeps the held follow-up card',
    (agent) => {
      render(agent)
      expect(mocks.sendArgs.at(-1)?.queue).toEqual({ capability: 'supported', enabled: true })
    }
  )

  it('Droid holds nothing: its queue is off', () => {
    render('droid')
    expect(mocks.sendArgs.at(-1)?.queue).toEqual({ capability: 'supported', enabled: false })
  })

  it('Droid says a send after a Stop is sent, not queued', () => {
    const { result } = render('droid')
    expect(nativeChatStructuredStopControls(result.current, true).composer.afterStop).toBe('send')
  })

  it('a waiting command card still queues a Droid send behind it', () => {
    queuedMessages = [
      {
        messageId: 'compact-1',
        position: 1,
        body: {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text: '/compact' }],
          command: { name: 'compact' }
        },
        state: 'waiting'
      }
    ]
    render('droid', false)
    expect(mocks.sendArgs.at(-1)?.queue).toEqual({ capability: 'supported', enabled: true })
  })
})
