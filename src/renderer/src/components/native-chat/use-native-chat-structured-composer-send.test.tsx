// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { dispatchStructuredAgentSessionComposerCommand } from '../../../../shared/structured-agent-session-composer'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'
import { answerDroidHostCommand, droidHelpText } from './droid-help-keys'
import { useNativeChatStructuredComposerSend } from './use-native-chat-structured-composer-send'

vi.mock('@/lib/native-chat-telemetry', () => ({ emitNativeChatMessageSent: vi.fn() }))
vi.mock('@/lib/worker-terminal-takeover-report', () => ({
  reportStructuredSessionUserInput: vi.fn()
}))

const ATTACHMENT = { id: 'a1', path: '/tmp/shot.png' } as NativeChatComposerImageAttachment

function harness(
  agent: AgentType,
  threadGoal?: NativeChatStructuredComposerTransport['threadGoal'],
  onSubmitted?: () => void,
  answerHostCommand?: (name: string) => string | null
) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; the hook under test reads only the members stubbed here.
  const structuredTransport = {
    send: vi.fn(() => true),
    dispatchCommand: (text: string) =>
      dispatchStructuredAgentSessionComposerCommand(text, {
        agent,
        snapshot: [],
        invokeAction: async () => true,
        setOption: async () => true,
        conversationCommands: ['clear', 'compact'],
        runConversationCommand: async () => ({ accepted: true, error: null }),
        ...(answerHostCommand ? { answerHostCommand } : {})
      }),
    optionSnapshot: [],
    onError: vi.fn(),
    runtime: 'local',
    sessionId: 'session-test',
    runtimeEnvironmentId: null
  } as unknown as NativeChatStructuredComposerTransport
  if (threadGoal) {
    structuredTransport.threadGoal = threadGoal
  }
  structuredTransport.onSubmitted = onSubmitted
  const setDraft = vi.fn()
  const { result } = renderHook(() =>
    useNativeChatStructuredComposerSend({
      agent,
      draftScopeKey: 'tab-1:pane',
      imageAttachments: [ATTACHMENT],
      structuredTransport,
      isComposing: () => false,
      clearSkillOrigin: vi.fn(),
      setDraft,
      setCaret: vi.fn()
    })
  )
  return { send: result.current, structuredTransport, setDraft }
}

// The guard exists because a host command sends no message, so its attachments
// would be dropped without a word. A pass-through command IS the message, so the
// attachments ride along with it.
describe('attachment guard follows what the host claims', () => {
  it.each([
    ['claude', '/clear'],
    ['claude', '/model'],
    ['codex', '/permissions'],
    ['droid', '/bug first\nprivate second'],
    ['droid', '  /BUG first\nprivate second ']
  ] as const)('refuses attachments on the host-claimed %s command %s', (agent, text) => {
    const { send, structuredTransport } = harness(agent)
    send(text)
    expect(structuredTransport.onError).toHaveBeenCalledWith(
      'Remove attachments before using a chat-session command.'
    )
    expect(structuredTransport.send).not.toHaveBeenCalled()
  })

  it.each([
    ['claude', '/init'],
    ['claude', '/review'],
    ['codex', '/goal ship the fix']
  ] as const)('sends %s attachments along with the passed-through %s', async (agent, text) => {
    const { send, structuredTransport } = harness(agent)
    send(text)
    await vi.waitFor(() =>
      expect(structuredTransport.send).toHaveBeenCalledWith(text, [ATTACHMENT])
    )
    expect(structuredTransport.onError).not.toHaveBeenCalledWith(
      'Remove attachments before using a chat-session command.'
    )
  })

  it('refuses attachments on /goal where the host sets the goal, since no message is sent', () => {
    const setObjective = vi.fn(async () => true)
    const { send, structuredTransport } = harness('codex', { setObjective })
    send('/goal ship the fix')
    expect(structuredTransport.onError).toHaveBeenCalledWith(
      'Remove attachments before using a chat-session command.'
    )
    expect(setObjective).not.toHaveBeenCalled()
    expect(structuredTransport.send).not.toHaveBeenCalled()
  })
})

describe('an attachment still uploading', () => {
  it('holds a picked command, as Send is held, rather than send the chip without its path', async () => {
    const { send, structuredTransport } = harness('claude')
    const pending: NativeChatComposerImageAttachment = {
      id: 'p1',
      path: '',
      pending: true,
      pendingName: 'notes.pdf'
    }
    send('/review', [pending])
    await Promise.resolve()
    expect(structuredTransport.send).not.toHaveBeenCalled()
    expect(structuredTransport.onError).not.toHaveBeenCalled()
  })
})

// The pane brings the latest into view on this: a conversation command at the press, a message
// once admitted, and neither for a refusal or a command the chat does not run.
describe('reports the sends that bring the latest into view', () => {
  it('reports a conversation command at the press, then not a message the transport refused', async () => {
    const onSubmitted = vi.fn()
    const { send, structuredTransport } = harness('claude', undefined, onSubmitted)
    send('/compact', [])
    expect(onSubmitted).toHaveBeenCalledOnce()

    vi.mocked(structuredTransport.send).mockReturnValue(false)
    send('hello', [])
    await vi.waitFor(() => expect(structuredTransport.onError).toHaveBeenCalledTimes(2))
    expect(structuredTransport.send).toHaveBeenCalledWith('hello', [])
    expect(onSubmitted).toHaveBeenCalledOnce()
  })

  it('reports nothing for a host command chat sessions do not run', async () => {
    const onSubmitted = vi.fn()
    const { send, structuredTransport } = harness('codex', undefined, onSubmitted)
    send('/permissions', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith(
        expect.stringContaining('not available in chat sessions'),
        undefined
      )
    )
    expect(onSubmitted).not.toHaveBeenCalled()
  })
})

describe("says a host's answer to a command as information, never as an error", () => {
  it('keeps a multiline /bug out of the message transport while asking for confirmation', async () => {
    const { send, structuredTransport, setDraft } = harness('droid')
    const runHostCommand = vi.fn(async () => ({
      accepted: false,
      error: null,
      info: 'Confirm before sending this report.'
    }))
    structuredTransport.dispatchCommand = (text) =>
      dispatchStructuredAgentSessionComposerCommand(text, {
        agent: 'droid',
        snapshot: [],
        invokeAction: async () => true,
        setOption: async () => true,
        runHostCommand
      })

    await send('  /BUG first\nprivate  second ', [])

    expect(runHostCommand).toHaveBeenCalledWith('bug', 'first\nprivate  second')
    expect(structuredTransport.onError).toHaveBeenCalledWith(
      'Confirm before sending this report.',
      { kind: 'info' }
    )
    expect(structuredTransport.send).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
  })

  it.each(['claude', 'codex'] as const)(
    'still sends multiline /bug text unchanged to %s',
    async (agent) => {
      const { send, structuredTransport } = harness(agent)
      const text = '/bug first\nprivate second'

      await send(text, [])

      expect(structuredTransport.send).toHaveBeenCalledWith(text, [])
    }
  )

  it("reports Droid's /help key list as information and sends no message", async () => {
    const { send, structuredTransport } = harness(
      'droid',
      undefined,
      undefined,
      answerDroidHostCommand
    )
    send('/help', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith(droidHelpText(), { kind: 'info' })
    )
    expect(structuredTransport.onError).toHaveBeenCalledTimes(1)
    expect(structuredTransport.send).not.toHaveBeenCalled()
  })

  it('keeps a Droid command the host refuses an error', async () => {
    const { send, structuredTransport } = harness('droid')
    send('/help', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith(
        expect.stringContaining('/help is not available in chat sessions'),
        undefined
      )
    )
    expect(structuredTransport.onError).not.toHaveBeenCalledWith(expect.anything(), {
      kind: 'info'
    })
  })

  it('shows an ask as information and keeps the command in the box, so Enter again answers it', async () => {
    const { send, structuredTransport, setDraft } = harness('droid')
    structuredTransport.dispatchCommand = async () => ({
      handled: true,
      accepted: false,
      error: null,
      info: 'Run /clear again to start a new session.'
    })
    send('/clear', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith(
        'Run /clear again to start a new session.',
        { kind: 'info' }
      )
    )
    expect(setDraft).not.toHaveBeenCalled()
    expect(structuredTransport.send).not.toHaveBeenCalled()
  })

  it('passes the action a command offers beside its answer, and still sends no message', async () => {
    const onClick = vi.fn()
    const { send, structuredTransport } = harness('droid')
    structuredTransport.dispatchCommand = async () => ({
      handled: true,
      accepted: true,
      error: null,
      info: 'Forked this conversation.',
      infoAction: { label: 'Open fork', onClick }
    })
    send('/fork', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith('Forked this conversation.', {
        kind: 'info',
        action: { label: 'Open fork', onClick }
      })
    )
    expect(structuredTransport.send).not.toHaveBeenCalled()
  })

  it('keeps a real error when an answer arrives with it', async () => {
    const { send, structuredTransport } = harness('droid')
    structuredTransport.dispatchCommand = async () => ({
      handled: true,
      accepted: false,
      error: 'The host could not run /help.',
      info: 'the key list'
    })
    send('/help', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith(
        'The host could not run /help.',
        undefined
      )
    )
    expect(structuredTransport.onError).not.toHaveBeenCalledWith(expect.anything(), {
      kind: 'info'
    })
  })

  it.each(['claude', 'codex'] as const)(
    'leaves /help to %s, with nothing said as information',
    async (agent) => {
      const { send, structuredTransport } = harness(
        agent,
        undefined,
        undefined,
        answerDroidHostCommand
      )
      send('/help', [])
      await vi.waitFor(() => expect(structuredTransport.send).toHaveBeenCalledWith('/help', []))
      expect(structuredTransport.onError).not.toHaveBeenCalledWith(expect.anything(), {
        kind: 'info'
      })
    }
  )
})

describe("says a failed send in Orca's words, with the error it hit apart", () => {
  it('keeps a main-process failure apart from the words saying the message was not sent', async () => {
    const { send, structuredTransport } = harness('claude')
    vi.mocked(structuredTransport.send).mockImplementation(() => {
      throw new Error(
        "Error invoking remote method 'agentSession:send': Error: connect ECONNREFUSED /tmp/a.sock"
      )
    })
    send('hello', [])
    await vi.waitFor(() =>
      expect(structuredTransport.onError).toHaveBeenCalledWith('Your message was not sent.', {
        errorText: 'connect ECONNREFUSED /tmp/a.sock'
      })
    )
  })
})
