// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { droidHelpText } from './droid-help-keys'
import { useNativeChatStructuredComposerTransport } from './use-native-chat-structured-composer-transport'

vi.mock('@/runtime/use-host-structured-agent', () => ({
  useStructuredAgentAcceptsImages: () => false
}))

type TransportArgs = Parameters<typeof useNativeChatStructuredComposerTransport>[0]

function dispatchHelp(agent: string) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; /help dispatch reads only the members stubbed here.
  const controller = {
    optionSnapshot: [],
    setStructuredOption: async () => true,
    conversationCommands: ['clear', 'compact'],
    runConversationCommand: async () => ({ accepted: true, error: null })
  } as unknown as TransportArgs['controller']
  const { result } = renderHook(() =>
    useNativeChatStructuredComposerTransport({
      props: { agent, sessionId: 'session-test', target: { kind: 'local' } },
      controller,
      sendThroughLaunch: () => true,
      starting: false,
      worktreeId: undefined,
      optionPickerRequest: null,
      setOptionPickerRequest: vi.fn(),
      onError: vi.fn(),
      onSubmitted: vi.fn(),
      queuedMessages: { queueHold: undefined, queueResume: undefined }
    })
  )
  return result.current.dispatchCommand('/help')
}

describe('the commands a structured chat answers itself', () => {
  it('answers /help with the key list as information for Droid', async () => {
    expect(await dispatchHelp('droid')).toMatchObject({
      handled: true,
      accepted: true,
      error: null,
      info: droidHelpText()
    })
  })

  it.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'])(
    'says nothing as information for %s',
    async (agent) => {
      expect((await dispatchHelp(agent)).info).toBeUndefined()
    }
  )
})
