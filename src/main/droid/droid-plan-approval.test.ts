import { describe, expect, it, vi } from 'vitest'
import { droidPermissionPresentation } from './droid-permission-requests'
import type { DroidPromptEnvironment, DroidPromptPresentation } from './droid-prompt-presentation'

const values = [
  'proceed_once',
  'proceed_auto_run_low',
  'proceed_auto_run_medium',
  'proceed_auto_run_high',
  'proceed_new_session',
  'proceed_new_session_low',
  'proceed_new_session_medium',
  'proceed_new_session_high',
  'cancel',
  'proceed_edit'
]
const request = (offered = values, supportsClientStartedHandoff = true) => ({
  toolUses: [
    {
      toolUse: { name: 'ExitSpecMode', input: {} },
      confirmationType: 'exit_spec_mode',
      details: { plan: 'Add a test.', title: 'Test plan', supportsClientStartedHandoff }
    }
  ],
  options: offered.map((value) => ({ value, label: value }))
})
const environment = (overrides: Partial<DroidPromptEnvironment> = {}): DroidPromptEnvironment => ({
  autonomyLevels: () => ['off', 'low', 'medium', 'high'],
  autonomyLevel: () => 'medium',
  beginSpecHandoff: () => 'handoff-id',
  ...overrides
})
const proceed = { kind: 'option', optionId: 'proceed_once' } as const

function permissions(first: DroidPromptPresentation, optionId = 'proceed_once') {
  const next = first.advance?.({ kind: 'option', optionId })
  if (!next || next.body.kind !== 'question') {
    throw new Error('Expected a permissions question')
  }
  return { ...next, body: next.body }
}

describe('Droid two-card plan approval', () => {
  it.each([
    [true, true, ['proceed_once', 'proceed_new_session', 'cancel']],
    [true, false, ['proceed_once', 'cancel']],
    [false, true, ['proceed_once', 'cancel']]
  ])(
    'offers the new-session action only with client support %s and host support %s',
    (client, host, ids) => {
      const first = droidPermissionPresentation(
        request(values, client),
        environment(host ? {} : { beginSpecHandoff: undefined })
      )
      expect(first.body.options.map(({ id }) => id)).toEqual(ids)
    }
  )

  it('lists only levels both offered for the chosen action and reported by Droid', () => {
    const first = droidPermissionPresentation(
      request(values.filter((value) => value !== 'proceed_auto_run_low')),
      environment({ autonomyLevels: () => ['off', 'low', 'medium'] })
    )
    expect(permissions(first).body.options).toEqual([
      { id: 'off', label: 'Off', description: 'Asks before edits and commands' },
      {
        id: 'medium',
        label: 'Medium (current)',
        description:
          'Also runs reversible commands like installs, builds and local commits; asks for the rest'
      }
    ])
    expect(permissions(first, 'proceed_new_session').body.options.map(({ id }) => id)).toEqual([
      'off',
      'low',
      'medium'
    ])
  })

  it.each(['off', 'low', 'medium', 'high'])('marks only the current %s level', (current) => {
    const first = droidPermissionPresentation(
      request(),
      environment({ autonomyLevel: () => current })
    )
    const rows = permissions(first).body.options
    expect(rows.filter(({ label }) => label.endsWith(' (current)')).map(({ id }) => id)).toEqual([
      current
    ])
  })

  it('reuses the permission picker descriptions for Low and High without marking an unknown current level', () => {
    const first = droidPermissionPresentation(
      request(),
      environment({ autonomyLevel: () => undefined })
    )
    expect(permissions(first).body.options).toMatchObject([
      { label: 'Off' },
      { label: 'Low', description: 'Edits files and runs read-only commands; asks for the rest' },
      { label: 'Medium' },
      { label: 'High', description: 'Runs commands without asking, except ones Droid blocks' }
    ])
  })

  it.each([
    ['proceed_once', 'off', 'proceed_once'],
    ['proceed_once', 'low', 'proceed_auto_run_low'],
    ['proceed_once', 'medium', 'proceed_auto_run_medium'],
    ['proceed_once', 'high', 'proceed_auto_run_high'],
    ['proceed_new_session', 'off', 'proceed_new_session'],
    ['proceed_new_session', 'low', 'proceed_new_session_low'],
    ['proceed_new_session', 'medium', 'proceed_new_session_medium'],
    ['proceed_new_session', 'high', 'proceed_new_session_high']
  ])('maps %s and %s to %s, carrying the review notes', (action, level, selectedOption) => {
    const beginSpecHandoff = vi.fn(() => 'handoff-id')
    const first = droidPermissionPresentation(request(), environment({ beginSpecHandoff }))
    const next = first.advance?.({
      kind: 'option',
      optionId: action,
      comment: ' One file. ',
      editedSpecContent: 'One test.'
    })
    expect(beginSpecHandoff).not.toHaveBeenCalled()
    expect(
      next?.reply(
        {
          kind: 'answers',
          answers: [{ questionId: 'q1', optionIds: [level] }]
        },
        'permissions-operation'
      )
    ).toEqual({
      selectedOption,
      comment: ' One file. ',
      editedSpecContent: 'One test.',
      ...(action === 'proceed_new_session'
        ? { clientStartsHandoffSession: true, specHandoffId: 'handoff-id' }
        : {})
    })
    if (action === 'proceed_new_session') {
      expect(beginSpecHandoff).toHaveBeenCalledExactlyOnceWith(
        selectedOption,
        'permissions-operation'
      )
    } else {
      expect(beginSpecHandoff).not.toHaveBeenCalled()
    }
  })

  it.each(['proceed_once', 'proceed_new_session'])(
    'skips permissions when only Off is possible for %s',
    (action) => {
      const first = droidPermissionPresentation(
        request(['proceed_once', 'proceed_new_session', 'cancel']),
        environment()
      )
      const choice = { kind: 'option', optionId: action } as const
      expect(first.advance?.(choice)).toBeNull()
      expect(first.reply(choice, 'plan-operation')).toMatchObject({ selectedOption: action })
    }
  )

  it('does not offer unreported auto-run levels when Droid has not reported its levels', () => {
    const first = droidPermissionPresentation(
      request(),
      environment({ autonomyLevels: () => undefined })
    )
    expect(first.advance?.(proceed)).toBeNull()
    expect(first.reply(proceed)).toEqual({ selectedOption: 'proceed_once' })
  })

  it('answers Keep iterating immediately and carries the comment', () => {
    const first = droidPermissionPresentation(request(), environment())
    const choice = { kind: 'option', optionId: 'cancel', comment: 'More detail.' } as const
    expect(first.advance?.(choice)).toBeNull()
    expect(first.reply(choice)).toEqual({ selectedOption: 'cancel', comment: 'More detail.' })
  })

  it('refuses dismissal, typed answers, multiple picks, and levels the permissions card did not offer', () => {
    const first = droidPermissionPresentation(
      request(),
      environment({ autonomyLevels: () => ['off', 'low'] })
    )
    const next = permissions(first)
    expect(next.body.questions).toMatchObject([{ multiSelect: false }])
    expect(next.body.questions?.[0]).not.toHaveProperty('freeTextQuestionId')
    expect(next.reply(null)).toEqual({ selectedOption: 'cancel' })
    for (const answer of [
      { questionId: 'q1', optionIds: [], other: 'low' },
      { questionId: 'q1', optionIds: ['off', 'low'] },
      { questionId: 'q1', optionIds: ['high'] }
    ]) {
      expect(() => next.reply({ kind: 'answers', answers: [answer] })).toThrow(
        /permissions Droid offered/
      )
    }
    expect(next.reply({ kind: 'option', optionId: 'low' })).toEqual({
      selectedOption: 'proceed_auto_run_low'
    })
  })
})
