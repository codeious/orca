// Droid's `exit_spec_mode` request, replayed from a recording of Droid 1.0.0. `comment` and
// `editedSpecContent` are fields of the SDK's permission result; the recording never exercised them.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionPromptResponse } from '../../shared/agent-session-question-answer'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import {
  playSteps,
  playUntilAsk,
  readDroidTurn,
  type DroidRecordedStep
} from './droid-recording.test-support'

afterEach(runDroidRigCleanups)

const FENCE = 7
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CAPTURED_OPTIONS = [
  'proceed_once',
  'proceed_auto_run_low',
  'proceed_auto_run_medium',
  'proceed_auto_run_high',
  'proceed_new_session',
  'proceed_new_session_low',
  'proceed_new_session_medium',
  'proceed_new_session_high',
  'cancel'
]

function choose(h: DroidAdapterRig, itemId: string, response: AgentSessionPromptResponse) {
  return h.adapter.answerPrompt({
    sessionId: DROID_RIG_SESSION,
    itemId,
    kind: 'approval',
    response,
    fence: FENCE,
    commit: async () => {}
  })
}

function openApproval(h: DroidAdapterRig) {
  return vi.waitFor(async () => {
    for (const { itemId, body } of await h.rig.rows()) {
      if (body.kind === 'approval') {
        return { itemId, body }
      }
    }
    throw new Error('No approval card yet')
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Rewrites the session notifications of one type; the rest of the recording plays as it was. */
function rewriting(
  steps: DroidRecordedStep[],
  type: string,
  change: (notification: Record<string, unknown>) => Record<string, unknown>
): DroidRecordedStep[] {
  return steps.map((step) => {
    if (
      step.kind !== 'notification' ||
      !isRecord(step.params) ||
      !isRecord(step.params.notification) ||
      step.params.notification.type !== type
    ) {
      return step
    }
    return { ...step, params: { ...step.params, notification: change(step.params.notification) } }
  })
}

/** Droid's report of the levels the session may run at, in place of the recorded four. */
function reportingLevels(steps: DroidRecordedStep[], levels: string[]): DroidRecordedStep[] {
  return rewriting(steps, 'settings_updated', (notification) => ({
    ...notification,
    settings: {
      ...(isRecord(notification.settings) ? notification.settings : {}),
      availableAutonomyLevels: levels
    }
  }))
}

/** Droid echoes the handoff id the client sent; the recording's was another run's. */
function echoingHandoffId(steps: DroidRecordedStep[], specHandoffId: string): DroidRecordedStep[] {
  return rewriting(steps, 'spec_handoff_session_created', (notification) => ({
    ...notification,
    specHandoffId
  }))
}

/** The recorded plan request with its first tool use's details changed. */
function askingWith(
  steps: DroidRecordedStep[],
  change: (details: Record<string, unknown>) => Record<string, unknown>
): DroidRecordedStep[] {
  return steps.map((step) => {
    const toolUses = step.kind === 'ask' && isRecord(step.params) ? step.params.toolUses : undefined
    const [first, ...others] = Array.isArray(toolUses) ? toolUses : []
    if (step.kind !== 'ask' || !isRecord(step.params) || !isRecord(first)) {
      return step
    }
    const details = isRecord(first.details) ? first.details : {}
    return {
      ...step,
      params: { ...step.params, toolUses: [{ ...first, details: change(details) }, ...others] }
    }
  })
}

async function askForPlan(
  levels?: string[],
  edit?: (steps: DroidRecordedStep[]) => DroidRecordedStep[]
) {
  const recorded = await readDroidTurn('spec-exit-spec-mode-handoff', 'spec-handoff')
  const leveled = levels ? reportingLevels(recorded, levels) : recorded
  const turn = edit ? edit(leveled) : leveled
  const h = await setupDroidAdapter({ autonomyLevel: 'off' })
  const { connection } = await h.start()
  const { answer, rest } = playUntilAsk(connection, turn)
  const card = await openApproval(h)
  return { h, connection, answer, rest, card }
}

describe('Droid Spec plan card', () => {
  it('shows the plan and every option Droid sent when the client may start the handoff', async () => {
    const { card } = await askForPlan()

    expect(card.body).toMatchObject({
      kind: 'approval',
      title: 'Review proposed plan',
      description: 'Create plan-probe.txt with "hello"',
      subject: { kind: 'plan', text: expect.stringContaining('Create a new file named') },
      resolution: { state: 'pending' }
    })
    expect(card.body.kind === 'approval' && card.body.options.map(({ id }) => id)).toEqual(
      CAPTURED_OPTIONS
    )
  })

  it.each(['proceed_new_session', 'proceed_new_session_low', 'proceed_new_session_high'])(
    'starts the handoff for %s, naming the id Droid is to echo',
    async (optionId) => {
      const { h, answer, card } = await askForPlan()

      await choose(h, card.itemId, { kind: 'option', optionId })

      await expect(answer).resolves.toEqual({
        selectedOption: optionId,
        clientStartsHandoffSession: true,
        specHandoffId: expect.stringMatching(UUID)
      })
    }
  )

  it.each([
    'proceed_once',
    'proceed_auto_run_low',
    'proceed_auto_run_medium',
    'proceed_auto_run_high'
  ])('answers %s with the option alone, so Droid carries on in this session', async (optionId) => {
    const { h, answer, card } = await askForPlan()

    await choose(h, card.itemId, { kind: 'option', optionId })

    await expect(answer).resolves.toEqual({ selectedOption: optionId })
  })

  it('keeps Spec on cancel: no handoff fields, and no handoff follows', async () => {
    const { h, connection, answer, rest, card } = await askForPlan()

    await choose(h, card.itemId, { kind: 'option', optionId: 'cancel' })

    await expect(answer).resolves.toEqual({ selectedOption: 'cancel' })
    playSteps(
      connection,
      rest.filter((step) => !JSON.stringify(step).includes('spec_handoff_session_created'))
    )
    await vi.waitFor(async () => expect(await h.rig.turns()).toHaveLength(1))
    expect((await h.rig.rows()).some(({ body }) => 'specHandoff' in body)).toBe(false)
  })

  it('offers only the autonomy levels the session reports', async () => {
    const { card } = await askForPlan(['off', 'low'])

    expect(card.body.kind === 'approval' && card.body.options.map(({ id }) => id)).toEqual([
      'proceed_once',
      'proceed_auto_run_low',
      'proceed_new_session',
      'proceed_new_session_low',
      'cancel'
    ])
  })

  it('refuses a level the session does not report', async () => {
    const { h, card } = await askForPlan(['off', 'low'])

    await expect(
      choose(h, card.itemId, { kind: 'option', optionId: 'proceed_auto_run_high' })
    ).rejects.toThrow(/one of the options Droid offered/)
  })

  it('takes a comment and an edited plan when the client may start the handoff', async () => {
    const { card } = await askForPlan()

    expect(card.body).toMatchObject({ acceptsComment: true, acceptsPlanEdit: true })
  })

  describe('from a Droid that does not name the client-started handoff', () => {
    const withoutHandoff = (steps: DroidRecordedStep[]) =>
      askingWith(steps, ({ supportsClientStartedHandoff: _flag, ...details }) => details)

    it('offers no new-session ending and no notes', async () => {
      const { card } = await askForPlan(undefined, withoutHandoff)

      expect(card.body.kind === 'approval' && card.body.options.map(({ id }) => id)).toEqual([
        'proceed_once',
        'proceed_auto_run_low',
        'proceed_auto_run_medium',
        'proceed_auto_run_high',
        'cancel'
      ])
      expect(card.body).not.toHaveProperty('acceptsComment')
      expect(card.body).not.toHaveProperty('acceptsPlanEdit')
    })

    it('answers with the option alone, whatever was typed', async () => {
      const { h, answer, card } = await askForPlan(undefined, withoutHandoff)

      await choose(h, card.itemId, {
        kind: 'option',
        optionId: 'proceed_once',
        comment: 'Go.',
        editedSpecContent: 'A plan'
      })

      await expect(answer).resolves.toEqual({ selectedOption: 'proceed_once' })
    })

    it('refuses a new-session ending', async () => {
      const { h, card } = await askForPlan(undefined, withoutHandoff)

      await expect(
        choose(h, card.itemId, { kind: 'option', optionId: 'proceed_new_session' })
      ).rejects.toThrow(/one of the options Droid offered/)
    })
  })

  it('offers no plan edit for a plan the journal clips, since the editor would start from the clip', async () => {
    const { card } = await askForPlan(undefined, (steps) =>
      askingWith(steps, (details) => ({ ...details, plan: 'a'.repeat(20 * 1024) }))
    )

    expect(card.body).toMatchObject({ acceptsComment: true })
    expect(card.body).not.toHaveProperty('acceptsPlanEdit')
  })

  it('never offers an edit ending Droid did not send', async () => {
    const { h, card } = await askForPlan()

    await expect(
      choose(h, card.itemId, { kind: 'option', optionId: 'proceed_edit' })
    ).rejects.toThrow(/one of the options Droid offered/)
  })

  it('sends the comment in the result, never as a message of its own', async () => {
    const { h, connection, answer, card } = await askForPlan()

    await choose(h, card.itemId, {
      kind: 'option',
      optionId: 'proceed_once',
      comment: 'Keep the file to one line.'
    })

    await expect(answer).resolves.toEqual({
      selectedOption: 'proceed_once',
      comment: 'Keep the file to one line.'
    })
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.add_user_message')
  })

  it('sends the edited plan in the result', async () => {
    const { h, answer, card } = await askForPlan()

    await choose(h, card.itemId, {
      kind: 'option',
      optionId: 'proceed_once',
      editedSpecContent: '## Plan\n\n1. Write hello.\n'
    })

    await expect(answer).resolves.toEqual({
      selectedOption: 'proceed_once',
      editedSpecContent: '## Plan\n\n1. Write hello.\n'
    })
  })

  it('leaves out a comment or an edit that holds nothing', async () => {
    const { h, answer, card } = await askForPlan()

    await choose(h, card.itemId, {
      kind: 'option',
      optionId: 'proceed_once',
      comment: '  \n',
      editedSpecContent: ''
    })

    await expect(answer).resolves.toEqual({ selectedOption: 'proceed_once' })
  })

  it('carries a comment beside the handoff fields', async () => {
    const { h, answer, card } = await askForPlan()

    await choose(h, card.itemId, {
      kind: 'option',
      optionId: 'proceed_new_session',
      comment: 'Go.'
    })

    await expect(answer).resolves.toEqual({
      selectedOption: 'proceed_new_session',
      clientStartsHandoffSession: true,
      specHandoffId: expect.stringMatching(UUID),
      comment: 'Go.'
    })
  })
})

describe('Droid Spec handoff', () => {
  async function handOff(optionId: string) {
    const { h, connection, answer, rest, card } = await askForPlan()
    await choose(h, card.itemId, { kind: 'option', optionId })
    const reply = await answer
    if (!isRecord(reply) || typeof reply.specHandoffId !== 'string') {
      throw new Error('The reply named no handoff id')
    }
    const { specHandoffId } = reply
    playSteps(connection, echoingHandoffId(rest, specHandoffId))
    return { h, reply: { specHandoffId } }
  }

  const handoffRow = async (h: DroidAdapterRig) =>
    (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'status' && body.specHandoff ? [body] : []
    )

  it('records the new session Droid made, once, beside the id the client sent', async () => {
    const { h, reply } = await handOff('proceed_new_session')

    await vi.waitFor(async () => {
      expect(await handoffRow(h)).toMatchObject([
        {
          specHandoff: {
            newSessionId: '00000000-0000-4000-8000-000000000007',
            initialPrompt: expect.stringMatching(/^Implement the following plan:/),
            specHandoffId: reply.specHandoffId
          }
        }
      ])
    })
    expect((await handoffRow(h))[0]?.specHandoff).not.toHaveProperty('autonomyLevel')
  })

  it.each([
    ['proceed_new_session_low', 'low'],
    ['proceed_new_session_medium', 'medium'],
    ['proceed_new_session_high', 'high']
  ])('names the level %s asked for', async (optionId, level) => {
    const { h } = await handOff(optionId)

    await vi.waitFor(async () => {
      expect((await handoffRow(h))[0]?.specHandoff).toMatchObject({ autonomyLevel: level })
    })
  })

  it('ends the planning turn as a success, with no error row', async () => {
    const { h } = await handOff('proceed_new_session')

    await vi.waitFor(async () => {
      expect(await h.rig.turns()).toMatchObject([{ state: 'completed', outcome: 'success' }])
    })
    const rows = await h.rig.rows()
    expect(rows.some(({ body }) => body.kind === 'status' && body.tone === 'error')).toBe(false)
  })

  it('ignores a handoff for an id this session never sent', async () => {
    const { h, connection, rest, card } = await askForPlan()
    await choose(h, card.itemId, { kind: 'option', optionId: 'proceed_new_session' })

    playSteps(connection, rest)

    await vi.waitFor(async () => expect(await h.rig.turns()).toHaveLength(1))
    expect(await handoffRow(h)).toEqual([])
  })

  it('does not hand off for an option that did not start one', async () => {
    const { h, connection, rest, card } = await askForPlan()
    await choose(h, card.itemId, { kind: 'option', optionId: 'proceed_once' })

    playSteps(connection, echoingHandoffId(rest, '00000000-0000-4000-8000-0000000000a1'))

    await vi.waitFor(async () => expect(await h.rig.turns()).toHaveLength(1))
    expect(await handoffRow(h)).toEqual([])
  })
})
