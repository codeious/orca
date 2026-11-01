// @vitest-environment happy-dom

// A model change Droid refuses, from Ctrl+N and from the menu, against the real mutate, option
// state and keys: Droid's sentence is in the toast, the pill stays on the model Droid holds, and the
// next Ctrl+N moves past the refused model instead of asking for it again.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  enqueue: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call,
  supportsStructuredAgentSessionQuietRepeatedStop: async () => false
}))

vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: mocks.enqueue
}))

vi.mock('@/lib/structured-agent-session-launch-options', () => ({
  holdStructuredAgentSessionLaunchOption: () => null,
  getStructuredAgentSessionLaunchSelection: () => null
}))

import type { AgentType } from '../../../../shared/agent-status-types'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { resetHostModelCatalogSnapshotsForTests } from '@/runtime/host-model-catalog-snapshots'
import { useNativeChatDroidComposerKeys } from './use-native-chat-droid-composer-keys'
import { useStructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useStructuredAgentSessionOptions } from './use-structured-agent-session-options'

const ORG_POLICY =
  "Model not allowed by organization policy: This model is not available due to your organization's security settings."
const MODEL_IDS = ['main', 'blocked', 'next']
const MODELS = MODEL_IDS.map((id, index) => ({
  id,
  label: id,
  isDefault: index === 0,
  efforts: []
}))

// Stable across renders: a fresh target or state would re-run the hooks' read effect forever.
const LOCAL_TARGET = { kind: 'local' } as const
const FENCE_STATE = { current: { fence: 1 } }
const NO_HELD: Record<string, string> = {}

type Refusal = { code: string; message: string; details?: { reason: string } }
type SetOptionParams = { key: string; value: string }

const EXPLAINED: Refusal = {
  code: 'agent_session_operation_invalid',
  message: ORG_POLICY,
  details: { reason: 'providerRefusedOption' }
}

/** A Droid that holds `main`, lists three models and refuses the ones named in `refuses`. */
function droidHost(refuses: Record<string, Refusal | Error>) {
  let model = 'main'
  const asked: string[] = []
  mocks.call.mockImplementation(async (_target: unknown, method: string, params: unknown) => {
    if (method === 'agentSession.options') {
      return { models: MODELS, current: { model, confirmed: ['model'] } }
    }
    if (method !== 'agentSession.setOption') {
      throw new Error(`unexpected ${method}`)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook sends setOption fields as { key, value } beside the envelope.
    const { key, value } = params as SetOptionParams
    asked.push(value)
    const refused = refuses[value]
    if (refused instanceof Error) {
      throw refused
    }
    if (refused) {
      return { ok: false, refusal: refused }
    }
    model = value
    return { ok: true, value: { key, value, options: { model } } }
  })
  return { asked, refuses }
}

function renderChat(agent: AgentType = 'droid') {
  const view = renderHook(() => {
    const { mutate } = useStructuredAgentSessionMutate({
      sessionId: 'session-1',
      target: LOCAL_TARGET,
      stateRef: FENCE_STATE
    })
    const options = useStructuredAgentSessionOptions({
      agent,
      sessionId: 'session-1',
      target: LOCAL_TARGET,
      transportEnabled: true,
      isVisible: true,
      providerVisible: true,
      fence: 1,
      turnId: null,
      unloadedTurnRevisions: undefined,
      mutate,
      launch: { kind: 'resume', heldOptions: NO_HELD }
    })
    const keys = useNativeChatDroidComposerKeys({
      agent,
      snapshot: options.optionSnapshot,
      surface: options.optionSurface
    })
    return { options, keys }
  })
  const modelRow = (): SessionOptionDescriptor | undefined =>
    view.result.current.options.optionSnapshot.find((row) => row.id === 'model')
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  return {
    result: view.result,
    modelRow,
    shownModel: () => {
      const kind = modelRow()?.kind
      return kind?.type === 'select' ? kind.currentValue : undefined
    },
    listedModels: () => {
      const kind = modelRow()?.kind
      return kind?.type === 'select' ? kind.choices.map((choice) => choice.value) : []
    },
    ready: () => waitFor(() => expect(modelRow()?.kind).toMatchObject({ currentValue: 'main' })),
    ctrlN: async () => {
      act(() => view.result.current.keys?.ctrlN?.())
      await settle()
    },
    pick: async (value: string) => {
      await act(() => view.result.current.options.optionSurface.setOption('model', value))
      await settle()
    }
  }
}

function toasts(): string[] {
  return mocks.toastError.mock.calls.map(([text]) => String(text))
}

beforeEach(() => {
  mocks.call.mockReset()
  mocks.enqueue.mockReset()
  mocks.toastError.mockReset()
  resetHostModelCatalogSnapshotsForTests()
})

describe('Ctrl+N onto a model Droid refuses', () => {
  it("shows Droid's reason and leaves the pill on the model Droid holds", async () => {
    const host = droidHost({ blocked: EXPLAINED })
    const chat = renderChat()
    await chat.ready()

    await chat.ctrlN()

    expect(host.asked).toEqual(['blocked'])
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toContain(ORG_POLICY)
    expect(toasts()[0]).toContain("wasn't changed")
    expect(chat.shownModel()).toBe('main')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('moves past it on the next press, and a full walk comes back to where it began', async () => {
    const host = droidHost({ blocked: EXPLAINED })
    const chat = renderChat()
    await chat.ready()

    await chat.ctrlN()
    await chat.ctrlN()
    expect(chat.shownModel()).toBe('next')
    await chat.ctrlN()

    expect(host.asked).toEqual(['blocked', 'next', 'main'])
    expect(chat.shownModel()).toBe('main')
    expect(toasts()).toHaveLength(1)
  })

  it('leaves the refused model listed in the menu', async () => {
    droidHost({ blocked: EXPLAINED })
    const chat = renderChat()
    await chat.ready()

    await chat.ctrlN()

    expect(chat.listedModels()).toEqual(MODEL_IDS)
  })
})

describe('a menu pick of a model Droid refuses', () => {
  it('shows the same notice and leaves the pill unchanged', async () => {
    const host = droidHost({ blocked: EXPLAINED })
    const chat = renderChat()
    await chat.ready()

    await chat.pick('blocked')

    expect(host.asked).toEqual(['blocked'])
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toContain(ORG_POLICY)
    expect(chat.shownModel()).toBe('main')
    expect(chat.listedModels()).toEqual(MODEL_IDS)
  })

  it('is skipped by the next Ctrl+N as well', async () => {
    const host = droidHost({ blocked: EXPLAINED })
    const chat = renderChat()
    await chat.ready()

    await chat.pick('blocked')
    await chat.ctrlN()

    expect(host.asked).toEqual(['blocked', 'next'])
    expect(chat.shownModel()).toBe('next')
  })

  it('is asked for again by Ctrl+N once Droid has taken it', async () => {
    const host = droidHost({ blocked: EXPLAINED })
    const chat = renderChat()
    await chat.ready()
    await chat.pick('blocked')

    delete host.refuses.blocked
    await chat.pick('blocked')
    expect(chat.shownModel()).toBe('blocked')
    await chat.ctrlN()
    await chat.ctrlN()
    await chat.ctrlN()

    expect(host.asked).toEqual(['blocked', 'blocked', 'next', 'main', 'blocked'])
  })
})

describe('a refusal that is not Droid giving a reason', () => {
  it('shows the generic words, never the message, and asks again on the next press', async () => {
    const host = droidHost({
      blocked: {
        code: 'agent_session_operation_invalid',
        message: 'internal: stack at droid-session-options.ts:112',
        details: { reason: 'optionRejected' }
      }
    })
    const chat = renderChat()
    await chat.ready()

    await chat.ctrlN()
    await chat.ctrlN()

    expect(host.asked).toEqual(['blocked', 'blocked'])
    expect(toasts()).toEqual([
      "The agent didn't accept this setting. The setting wasn't changed.",
      "The agent didn't accept this setting. The setting wasn't changed."
    ])
  })

  it('asks again after a request that failed without an answer', async () => {
    const host = droidHost({ blocked: new Error('the connection dropped') })
    const chat = renderChat()
    await chat.ready()

    await chat.ctrlN()
    await chat.ctrlN()

    expect(host.asked).toEqual(['blocked', 'blocked'])
    expect(chat.shownModel()).toBe('main')
  })
})

describe('another agent', () => {
  it.each(['claude', 'codex', 'pi', 'gemini'] as const)(
    'keeps no refused models for %s, whatever reason a host names',
    async (agent) => {
      const host = droidHost({ blocked: EXPLAINED })
      const chat = renderChat(agent)
      await chat.ready()

      await chat.pick('blocked')

      expect(host.asked).toEqual(['blocked'])
      expect(chat.result.current.options.optionSurface.refusedModelIds).toBeUndefined()
    }
  )
})
