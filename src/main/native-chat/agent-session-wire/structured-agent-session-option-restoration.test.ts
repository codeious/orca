import { describe, expect, it } from 'vitest'
import { nativeSessionOptionsFromReport } from './structured-agent-session-option-restoration'

describe('options recorded once the provider has reported', () => {
  it('keeps the Spec state the provider reports instead of the saved one', () => {
    expect(
      nativeSessionOptionsFromReport({
        reported: { model: 'opus', planMode: true },
        restoreSkipped: [],
        priorOptions: { model: 'opus', planMode: 'false' }
      })
    ).toEqual({ model: 'opus', planMode: 'true' })
  })

  it('drops a saved Spec state the provider no longer reports', () => {
    expect(
      nativeSessionOptionsFromReport({
        reported: { model: 'opus' },
        restoreSkipped: [],
        priorOptions: { model: 'opus', planMode: 'true' }
      })
    ).toEqual({ model: 'opus' })
  })

  it('does not keep a Spec state the child could not take', () => {
    expect(
      nativeSessionOptionsFromReport({
        reported: { model: 'opus' },
        restoreSkipped: ['planMode'],
        priorOptions: { planMode: 'true' }
      })
    ).toEqual({ model: 'opus' })
  })
})
