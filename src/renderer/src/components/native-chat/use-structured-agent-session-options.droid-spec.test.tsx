// @vitest-environment happy-dom
import { act, waitFor } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import {
  mocks,
  answer,
  mutateWith,
  REOPENED,
  renderOptions,
  currentValue,
  descriptor
} from './use-structured-agent-session-options.test-fixture'
import { forgetStructuredSessionSelection } from '@/lib/structured-agent-session-selection-controller'
import { resetHostModelCatalogSnapshotsForTests } from '@/runtime/host-model-catalog-snapshots'

beforeEach(() => {
  mocks.sendSelection = false
  mocks.coherentCatalog = false
  mocks.call.mockReset()
  mocks.enqueue.mockReset()
  mocks.hold.mockReset()
  mocks.toastError.mockReset()
  forgetStructuredSessionSelection('session-1')
  resetHostModelCatalogSnapshotsForTests()
})

it('re-reads the model and effort rows after toggling Droid Spec without changing saved main picks', async () => {
  let spec = false
  answer({
    options: async () => ({
      models: [
        { id: 'main', label: 'Main', isDefault: false, efforts: [{ value: 'low', label: 'Low' }] },
        {
          id: 'planner',
          label: 'Planner',
          isDefault: false,
          efforts: [{ value: 'high', label: 'High' }]
        }
      ],
      current: {
        planMode: spec,
        model: spec ? 'planner' : 'main',
        effort: spec ? 'high' : 'low',
        confirmed: ['planMode', 'model', 'effort']
      }
    })
  })
  const { mutate } = mutateWith(async () => {
    spec = !spec
    return { options: { planMode: String(spec), model: 'main', effort: 'low' } }
  })
  const { result, unmount } = renderOptions({ ...REOPENED, agent: 'droid' }, mutate)
  await waitFor(() => expect(currentValue(result.current.optionSnapshot, 'model')).toBe('main'))
  for (const on of [true, false]) {
    await act(async () => {
      expect(await result.current.setStructuredOption('planMode', on)).toBe(true)
    })
    await waitFor(() =>
      expect(currentValue(result.current.optionSnapshot, 'model')).toBe(on ? 'planner' : 'main')
    )
    expect(descriptor(result.current.optionSnapshot, 'effort')).toMatchObject({
      kind: {
        currentValue: on ? 'high' : 'low',
        choices: [{ value: on ? 'high' : 'low' }]
      }
    })
  }
  unmount()
})
