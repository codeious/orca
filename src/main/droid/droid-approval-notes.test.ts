import { describe, expect, it } from 'vitest'
import { droidPermissionPresentation } from './droid-permission-requests'

const request = (supportsClientStartedHandoff?: boolean, plan = '1. Add a test.') => ({
  toolUses: [
    {
      toolUse: { name: 'ExitSpecMode', input: {} },
      confirmationType: 'exit_spec_mode',
      details: { plan, supportsClientStartedHandoff }
    }
  ],
  options: [
    { value: 'proceed_once', label: 'Proceed' },
    { value: 'cancel', label: 'Keep planning' }
  ]
})
const environment = { autonomyLevels: () => undefined }
const response = {
  kind: 'option',
  optionId: 'proceed_once',
  comment: ' One file only. ',
  editedSpecContent: '1. Add one test.'
} as const

describe('Droid plan notes', () => {
  it('offers notes and forwards their exact text only after Droid reports support', () => {
    const presentation = droidPermissionPresentation(request(true), environment)
    expect(presentation.body).toMatchObject({ acceptsComment: true, acceptsPlanEdit: true })
    expect(presentation.reply(response)).toEqual({
      selectedOption: 'proceed_once',
      comment: response.comment,
      editedSpecContent: response.editedSpecContent
    })
    expect(presentation.reply(null)).toEqual({ selectedOption: 'cancel' })
  })

  it('keeps legacy approvals free of note fields', () => {
    const presentation = droidPermissionPresentation(request(), environment)
    expect(presentation.body).not.toHaveProperty('acceptsComment')
    expect(presentation.reply(response)).toEqual({ selectedOption: 'proceed_once' })
  })

  it('never opens an editor with a clipped plan', () => {
    expect(
      droidPermissionPresentation(request(true, 'x'.repeat(140 * 1024)), environment).body
    ).not.toHaveProperty('acceptsPlanEdit')
  })
})
