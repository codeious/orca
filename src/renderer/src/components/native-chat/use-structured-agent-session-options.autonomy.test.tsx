// @vitest-environment happy-dom
// The autonomy level of a Droid chat rides the options surface beside the pills: all four levels
// before a child reports, only the reported ones after, set through setOption, shown as Droid holds
// it, and never remembered as a per-model default.

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
  }
]

// Stable across renders: a fresh target or held map would re-run the hook's read effect forever.
const LOCAL_TARGET = { kind: 'local' } as const
const NO_HELD: Record<string, string> = {}

type PickFields = { key: string; value: string }

/** A Droid session that holds the level it was last told, unless it lowers it, and reports it. */
function droidSession(start: { level: string; available?: string[]; lowersTo?: string }) {
  let level = start.level
  const options = () =>
    Promise.resolve({
      models: MODELS,
      current: {
        model: 'main-model',
        effort: 'high',
        autonomyLevel: level,
        ...(start.available ? { availableAutonomyLevels: start.available } : {}),
        confirmed: ['model', 'effort']
      }
    })
  mocks.call.mockImplementation((_target: unknown, method: string) =>
    method === 'agentSession.options' ? options() : new Promise(() => {})
  )
  const mutate = vi.fn(async (_method: string, _label: string, fields: PickFields) => {
    if (fields.key !== 'autonomyLevel') {
      throw new Error(`the autonomy session was sent ${fields.key}`)
    }
    level = start.lowersTo ?? fields.value
    return {
      key: fields.key,
      value: fields.value,
      options: { model: 'main-model', autonomyLevel: level }
    }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reply is the AgentSessionOptionResult shape the hook reads.
  return { mutate, send: mutate as unknown as StructuredAgentSessionMutate }
}

function renderDroid(
  mutate: StructuredAgentSessionMutate,
  props: {
    agent?: 'droid' | 'claude'
    fence?: number | null
    transportEnabled?: boolean
    heldOptions?: Record<string, string>
  } = {}
) {
  const fence = props.fence === undefined ? 1 : props.fence
  return renderHook(() =>
    useStructuredAgentSessionOptions({
      agent: props.agent ?? 'droid',
      sessionId: 'session-1',
      target: LOCAL_TARGET,
      transportEnabled: props.transportEnabled ?? fence !== null,
      isVisible: true,
      providerVisible: true,
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

const FOUR = ['off', 'low', 'medium', 'high']

describe('the autonomy level on the options surface of a Droid chat', () => {
  beforeEach(() => {
    mocks.call.mockReset()
    mocks.enqueue.mockReset()
    mocks.hold.mockReset()
    resetHostModelCatalogSnapshotsForTests()
  })

  it('offers all four levels while no child has reported which it offers', async () => {
    const { send } = droidSession({ level: 'high' })
    const { result } = renderDroid(send)

    await waitFor(() =>
      expect(result.current.optionSurface.autonomy).toEqual({
        level: 'high',
        levels: FOUR,
        settable: true
      })
    )
  })

  it('offers only the levels Droid reports, and shows the level it holds', async () => {
    const { send } = droidSession({ level: 'low', available: ['off', 'low'] })
    const { result } = renderDroid(send)

    await waitFor(() =>
      expect(result.current.optionSurface.autonomy).toEqual({
        level: 'low',
        levels: ['off', 'low'],
        settable: true
      })
    )
  })

  it('names no level while the answer names none', async () => {
    const { mutate, send } = droidSession({ level: 'high' })
    mocks.call.mockImplementation((_target: unknown, method: string) =>
      method === 'agentSession.options'
        ? Promise.resolve({ models: MODELS, current: { model: 'main-model', effort: 'high' } })
        : new Promise(() => {})
    )
    const { result } = renderDroid(send)
    await waitFor(() => expect(mainPills(result.current.optionSnapshot).length).toBe(2))

    expect(result.current.optionSurface.autonomy).toBeUndefined()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('sets a level through the session, and the main pills do not move', async () => {
    const { mutate, send } = droidSession({ level: 'high' })
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.autonomy).toBeDefined())
    const before = mainPills(result.current.optionSnapshot)

    await act(() => result.current.optionSurface.setOption('autonomyLevel', 'low'))

    await waitFor(() => expect(result.current.optionSurface.autonomy?.level).toBe('low'))
    expect(mutate.mock.calls.map(([method, , fields]) => [method, fields])).toEqual([
      ['agentSession.setOption', { key: 'autonomyLevel', value: 'low' }]
    ])
    expect(mainPills(result.current.optionSnapshot)).toEqual(before)
  })

  it('is never remembered as a per-model default for the next chat', async () => {
    const { send } = droidSession({ level: 'high' })
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.autonomy).toBeDefined())

    await act(() => result.current.optionSurface.setOption('autonomyLevel', 'off'))
    await waitFor(() => expect(result.current.optionSurface.autonomy?.level).toBe('off'))

    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('shows the level Droid reports when it lowers the one asked for', async () => {
    const { send } = droidSession({ level: 'low', lowersTo: 'low' })
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.autonomy?.level).toBe('low'))

    await act(() => result.current.optionSurface.setOption('autonomyLevel', 'high'))

    await waitFor(() => expect(result.current.optionSurface.autonomy?.level).toBe('low'))
  })

  it('sends nothing for a level Droid did not offer', async () => {
    const { mutate, send } = droidSession({ level: 'low', available: ['off', 'low'] })
    const { result } = renderDroid(send)
    await waitFor(() => expect(result.current.optionSurface.autonomy).toBeDefined())

    await act(() => result.current.optionSurface.setOption('autonomyLevel', 'high'))
    await act(() => result.current.optionSurface.setOption('autonomyLevel', 'ultra'))

    expect(mutate).not.toHaveBeenCalled()
    expect(result.current.optionSurface.autonomy?.level).toBe('low')
  })

  it('holds a pick made before the launch has a fence, and shows it meanwhile', async () => {
    const { mutate, send } = droidSession({ level: 'high' })
    mocks.hold.mockReturnValue(new Promise(() => {}))
    const { result } = renderDroid(send, {
      fence: null,
      transportEnabled: false,
      heldOptions: { autonomyLevel: 'low' }
    })

    await waitFor(() => expect(result.current.optionSurface.autonomy).toBeDefined())
    expect(result.current.optionSurface.autonomy?.level).toBe('low')
    await act(() => result.current.optionSurface.setOption('autonomyLevel', 'medium'))

    expect(mocks.hold).toHaveBeenCalledWith('session-1', 'autonomyLevel', 'medium')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('is offered to no other agent', async () => {
    const { send } = droidSession({ level: 'high' })
    const { result } = renderDroid(send, { agent: 'claude' })
    await act(async () => {})

    expect(result.current.optionSurface.autonomy).toBeUndefined()
  })
})
