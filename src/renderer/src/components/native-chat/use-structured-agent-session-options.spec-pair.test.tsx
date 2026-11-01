// @vitest-environment happy-dom
// The Spec model and effort of a Droid chat ride the options surface beside the pills: set and
// cleared through the same setOption, held before a fence, and never moving the main pair.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  enqueue: vi.fn(),
  hold: vi.fn<(sessionId: string, id: string, encoded: string) => Promise<unknown> | null>()
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: mocks.enqueue
}))

vi.mock('@/lib/structured-agent-session-launch-options', () => ({
  holdStructuredAgentSessionLaunchOption: mocks.hold,
  getStructuredAgentSessionLaunchSelection: () => null
}))

import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useStructuredAgentSessionOptions } from './use-structured-agent-session-options'
import { resetHostModelCatalogSnapshotsForTests } from '@/runtime/host-model-catalog-snapshots'

const MODELS = [
  {
    id: 'main-model',
    label: 'Main Model',
    isDefault: true,
    efforts: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' }
    ]
  },
  {
    id: 'cheap-model',
    label: 'Cheap Model',
    efforts: [
      { value: 'off', label: 'Off' },
      { value: 'medium', label: 'Medium' }
    ]
  }
]

// Stable across renders: a fresh target or held map would re-run the hook's read effect forever.
const LOCAL_TARGET = { kind: 'local' } as const
const NO_HELD: Record<string, string> = {}

type Pair = { specModel?: string; specEffort?: string }
type PickFields = { key: string; value: string }

function isPairKey(key: string): key is keyof Pair {
  return key === 'specModel' || key === 'specEffort'
}

/** A Droid session that holds the pair it was last told and reports it on every read. */
function droidSession(pair: Pair = {}) {
  const held = { ...pair }
  const options = () =>
    Promise.resolve({
      models: MODELS,
      current: {
        model: 'main-model',
        effort: 'high',
        planMode: true,
        ...held,
        confirmed: ['model', 'effort', 'planMode']
      }
    })
  mocks.call.mockImplementation((_target: unknown, method: string) =>
    method === 'agentSession.options' ? options() : new Promise(() => {})
  )
  const mutate = vi.fn(async (_method: string, _label: string, fields: PickFields) => {
    const { key, value } = fields
    if (!isPairKey(key)) {
      throw new Error(`the Spec pair session was sent ${key}`)
    }
    if (value === 'same-as-main') {
      delete held[key]
      if (key === 'specModel') {
        delete held.specEffort
      }
    } else {
      held[key] = value
    }
    return { key, value, options: { planMode: 'true', model: 'main-model', ...held } }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reply is the AgentSessionOptionResult shape the hook reads.
  return { mutate, send: mutate as unknown as StructuredAgentSessionMutate }
}

function renderDroid(
  mutate: StructuredAgentSessionMutate,
  props: {
    agent?: 'droid' | 'claude'
    fence?: number | null
    heldOptions?: Record<string, string>
  } = {}
) {
  const fence = props.fence === undefined ? 1 : props.fence
  return renderHook(() =>
    useStructuredAgentSessionOptions({
      agent: props.agent ?? 'droid',
      sessionId: 'session-1',
      target: LOCAL_TARGET,
      transportEnabled: fence !== null,
      isVisible: true,
      providerVisible: fence !== null,
      fence,
      turnId: null,
      unloadedTurnRevisions: undefined,
      mutate,
      launch: { kind: 'resume', heldOptions: props.heldOptions ?? NO_HELD }
    })
  )
}

function mainPills(snapshot: readonly SessionOptionDescriptor[]) {
  return snapshot.filter((entry) => entry.id === 'model' || entry.id === 'effort')
}

describe('the Spec pair on the options surface of a Droid chat', () => {
  beforeEach(() => {
    mocks.call.mockReset()
    mocks.enqueue.mockReset()
    mocks.hold.mockReset()
    resetHostModelCatalogSnapshotsForTests()
  })

  it('shows the pair the session reports, with the main pills as they are', async () => {
    const { send } = droidSession({ specModel: 'cheap-model', specEffort: 'off' })
    const { result } = renderDroid(send)

    await waitFor(() =>
      expect(result.current.optionSurface.specPair).toMatchObject({
        model: 'cheap-model',
        effort: 'off',
        settable: true
      })
    )
    expect(mainPills(result.current.optionSnapshot).map((entry) => entry.id)).toEqual([
      'model',
      'effort'
    ])
  })

  it('sets the model and then the effort, and the main pills do not move', async () => {
    const { mutate, send } = droidSession()
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.specPair).toBeDefined())
    const before = mainPills(result.current.optionSnapshot)

    await act(() => result.current.optionSurface.setOption('specModel', 'cheap-model'))
    await act(() => result.current.optionSurface.setOption('specEffort', 'off'))

    await waitFor(() =>
      expect(result.current.optionSurface.specPair).toMatchObject({
        model: 'cheap-model',
        effort: 'off'
      })
    )
    expect(mutate.mock.calls.map(([method, , fields]) => [method, fields])).toEqual([
      ['agentSession.setOption', { key: 'specModel', value: 'cheap-model' }],
      ['agentSession.setOption', { key: 'specEffort', value: 'off' }]
    ])
    expect(mainPills(result.current.optionSnapshot)).toEqual(before)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('clears the pair with the same-as-main choice, and neither value shows after', async () => {
    const { mutate, send } = droidSession({ specModel: 'cheap-model', specEffort: 'off' })
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.specPair?.model).toBe('cheap-model'))

    await act(() => result.current.optionSurface.setOption('specModel', 'same-as-main'))

    await waitFor(() =>
      expect(result.current.optionSurface.specPair).toMatchObject({ model: null, effort: null })
    )
    expect(mutate).toHaveBeenCalledWith('agentSession.setOption', 'agentSession.setOption', {
      key: 'specModel',
      value: 'same-as-main'
    })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('sends nothing for a model the host did not list', async () => {
    const { mutate, send } = droidSession()
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.specPair).toBeDefined())

    await act(() => result.current.optionSurface.setOption('specModel', 'not-listed'))

    expect(mutate).not.toHaveBeenCalled()
    expect(result.current.optionSurface.specPair?.model).toBeNull()
  })

  it('holds a pick made before the launch has a fence, and shows it meanwhile', async () => {
    const { mutate, send } = droidSession()
    mocks.hold.mockReturnValue(new Promise(() => {}))
    // No fence and no session read yet: the host's list is what the control can offer.
    mocks.call.mockImplementation((_target: unknown, method: string) =>
      method === 'agentSession.modelCatalog'
        ? Promise.resolve({ origin: 'probe', models: MODELS, fetchedAt: 1_000 })
        : new Promise(() => {})
    )
    const { result } = renderDroid(send, { fence: null, heldOptions: { specModel: 'cheap-model' } })

    await waitFor(() => expect(result.current.optionSurface.specPair).toBeDefined())
    expect(result.current.optionSurface.specPair?.model).toBe('cheap-model')
    // The effort is offered under the Spec model that is held, not the main one.
    await act(() => result.current.optionSurface.setOption('specEffort', 'off'))
    expect(mocks.hold).toHaveBeenCalledWith('session-1', 'specEffort', 'off')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('is offered to no other agent', async () => {
    const { send } = droidSession()
    const { result } = renderDroid(send, { agent: 'claude' })
    await act(async () => {})

    expect(result.current.optionSurface.specPair).toBeUndefined()
  })
})
