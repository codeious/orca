import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import {
  playSteps,
  playUntilAsk,
  readDroidExchanges,
  readDroidTurn,
  replayExchange
} from './droid-recording.test-support'

afterEach(runDroidRigCleanups)

const FENCE = 7

function choose(h: DroidAdapterRig, itemId: string, optionId: string, commit = async () => {}) {
  return h.adapter.answerPrompt({
    sessionId: DROID_RIG_SESSION,
    itemId,
    kind: 'approval',
    response: { kind: 'option', optionId },
    fence: FENCE,
    commit
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

async function planApproval() {
  const exchanges = await readDroidExchanges('spec-plan-approval-off')
  const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection) => {
    connection.replies.set('droid.initialize_session', replayExchange(connection, exchanges, 'r1'))
  })
  const { connection } = await h.start()
  const turn = await readDroidTurn('spec-plan-approval-off', 'spec-plan')
  return { h, connection, turn }
}

function openPermissions(h: DroidAdapterRig) {
  return vi.waitFor(async () => {
    const row = (await h.rig.rows()).find(({ body }) => body.kind === 'question')
    if (!row) {
      throw new Error('No permissions card yet')
    }
    return row
  })
}

describe('Droid approval cards', () => {
  it('puts the command Droid wants to run on a card with every option Droid offers', async () => {
    const turn = await readDroidTurn('autonomy-off-exec-and-patch', 'exec')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' })
    const { connection } = await h.start()
    playUntilAsk(connection, turn)

    expect((await openApproval(h)).body).toMatchObject({
      kind: 'approval',
      title: 'Allow Execute?',
      detail: 'echo hello-probe',
      options: [
        { id: 'proceed_once', label: 'Yes, allow' },
        {
          id: 'proceed_always',
          label: 'Yes, and always allow low impact commands (file edits and read-only commands)'
        },
        { id: 'cancel', label: 'No, cancel' }
      ],
      resolution: { state: 'pending' }
    })
  })

  it('saves the choice before telling Droid, then shows the tool Droid runs', async () => {
    const turn = await readDroidTurn('autonomy-off-exec-and-patch', 'exec')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' })
    const { connection } = await h.start()
    const { answer, rest } = playUntilAsk(connection, turn)
    const card = await openApproval(h)
    const order: string[] = []
    void answer.then(() => order.push('reply'))

    await choose(h, card.itemId, 'proceed_always', async () => {
      order.push('commit')
    })

    await expect(answer).resolves.toEqual({ selectedOption: 'proceed_always' })
    expect(order).toEqual(['commit', 'reply'])
    await expect(choose(h, card.itemId, 'proceed_once')).rejects.toThrow(/no longer waiting/)
    playSteps(connection, rest)
    await vi.waitFor(async () => {
      const tools = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'tool-call' ? [body] : []
      )
      expect(tools).toMatchObject([{ name: 'Execute', state: 'completed' }])
    })
  })

  it.each([
    ['autonomy-high-rules', 'exec-ask-rule', 'Rule: probe/ask-echo'],
    [
      'legacy-blocklist-and-denylist',
      'exec-legacy-denylist',
      'Matched deny-list entry "echo LEGACYASK". Deny-listed commands always require manual approval.'
    ]
  ])('still asks under Yolo when %s makes a command ask', async (name, label, reason) => {
    const turn = await readDroidTurn(name, label)
    const h = await setupDroidAdapter({ autonomyLevel: 'high' })
    const { connection } = await h.start()
    const { answer } = playUntilAsk(connection, turn)
    const card = await openApproval(h)

    expect(card.body).toMatchObject({
      kind: 'approval',
      decisionReason: reason,
      options: [
        { id: 'proceed_once', label: 'Yes, allow' },
        { id: 'cancel', label: 'No, cancel' }
      ],
      resolution: { state: 'pending' }
    })
    await choose(h, card.itemId, 'proceed_once')
    await expect(answer).resolves.toEqual({ selectedOption: 'proceed_once' })
  })

  it.each([
    ['autonomy-high-rules', 'exec-block-rule'],
    ['legacy-blocklist-and-denylist', 'exec-legacy-block']
  ])(
    "shows a command %s blocks as a failed tool with Droid's own words, and asks nothing",
    async (name, label) => {
      const turn = await readDroidTurn(name, label)
      const h = await setupDroidAdapter({ autonomyLevel: 'high' })
      const { connection } = await h.start()

      playSteps(connection, turn)

      await vi.waitFor(async () => {
        const rows = await h.rig.rows()
        expect(rows.some(({ body }) => body.kind === 'approval')).toBe(false)
        expect(rows.map(({ body }) => body)).toContainEqual(
          expect.objectContaining({
            kind: 'tool-call',
            name: 'Execute',
            state: 'failed',
            output: expect.objectContaining({
              head: expect.stringContaining('blocked by your organization')
            })
          })
        )
      })
    }
  )

  it('reviews the plan first, then asks permissions and answers Droid once with Medium', async () => {
    const { h, connection, turn } = await planApproval()
    connection.notify({ type: 'settings_updated', settings: { interactionMode: 'spec' } })
    h.lifecycle.mockClear()
    const { answer } = playUntilAsk(connection, turn)
    const card = await openApproval(h)

    expect(card.body).toMatchObject({
      kind: 'approval',
      title: 'Review proposed plan',
      description: 'Add notes.txt',
      subject: {
        kind: 'plan',
        text: '- Create `notes.txt` in the current directory containing the single word `hello`.\n- Verify the file contents.'
      },
      options: [
        { id: 'proceed_once', label: 'Proceed with implementation' },
        { id: 'cancel', label: 'No, keep iterating on spec' }
      ]
    })
    await expect(choose(h, card.itemId, 'proceed_new_session_high')).rejects.toThrow(
      /one of the options Droid offered/
    )
    let heard = false
    void answer.then(() => (heard = true))
    await choose(h, card.itemId, 'proceed_once')
    const permissions = await openPermissions(h)
    expect(permissions.body).toMatchObject({
      kind: 'question',
      question: 'Permissions',
      options: [
        { id: 'off', label: 'Off (current)' },
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' }
      ]
    })
    expect(heard).toBe(false)
    await h.adapter.answerPrompt({
      sessionId: DROID_RIG_SESSION,
      itemId: permissions.itemId,
      kind: 'question',
      response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['medium'] }] },
      fence: FENCE,
      commit: async () => {}
    })
    await expect(answer).resolves.toEqual({ selectedOption: 'proceed_auto_run_medium' })
    expect(h.lifecycle).not.toHaveBeenCalled()
    connection.notify({
      type: 'settings_updated',
      settings: { interactionMode: 'auto', autonomyLevel: 'medium' }
    })
    expect(h.lifecycle).toHaveBeenCalledExactlyOnceWith({
      type: 'options-reported',
      sessionId: DROID_RIG_SESSION,
      fence: FENCE,
      acquisitionGeneration: expect.any(String),
      reportedOptions: expect.objectContaining({ planMode: false }),
      providerPicks: { planMode: 'false', autonomyLevel: 'medium' }
    })
    expect(
      (await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })).current.planMode
    ).toBe(false)
    const picks = await h.adapter.setOption({
      sessionId: DROID_RIG_SESSION,
      fence: FENCE,
      key: 'effort',
      value: 'low'
    })
    expect(picks).toMatchObject({ planMode: 'false', autonomyLevel: 'medium' })
  })

  it('keeps iterating without asking permissions', async () => {
    const { h, connection, turn } = await planApproval()
    const { answer } = playUntilAsk(connection, turn)
    await choose(h, (await openApproval(h)).itemId, 'cancel')
    await expect(answer).resolves.toEqual({ selectedOption: 'cancel' })
    expect((await h.rig.rows()).some(({ body }) => body.kind === 'question')).toBe(false)
  })

  it('leaves Spec without pinning permissions when no Permissions card was asked', async () => {
    const { h, connection, turn } = await planApproval()
    connection.notify({
      type: 'settings_updated',
      settings: { interactionMode: 'spec', availableAutonomyLevels: ['off'] }
    })
    h.lifecycle.mockClear()
    const { answer } = playUntilAsk(connection, turn)
    await choose(h, (await openApproval(h)).itemId, 'proceed_once')
    await expect(answer).resolves.toEqual({ selectedOption: 'proceed_once' })
    expect((await h.rig.rows()).some(({ body }) => body.kind === 'question')).toBe(false)
    connection.notify({
      type: 'settings_updated',
      settings: { interactionMode: 'auto', autonomyLevel: 'off' }
    })
    expect(h.lifecycle).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        reportedOptions: expect.objectContaining({ planMode: false }),
        providerPicks: { planMode: 'false' }
      })
    )
    connection.notify({ type: 'settings_updated', settings: { interactionMode: 'auto' } })
    expect(h.lifecycle).toHaveBeenCalledTimes(1)
  })

  it('does not remember permissions from an approval that failed to save', async () => {
    const { h, connection, turn } = await planApproval()
    connection.notify({ type: 'settings_updated', settings: { interactionMode: 'spec' } })
    h.lifecycle.mockClear()
    playUntilAsk(connection, turn)
    await choose(h, (await openApproval(h)).itemId, 'proceed_once')
    await expect(
      h.adapter.answerPrompt({
        sessionId: DROID_RIG_SESSION,
        itemId: (await openPermissions(h)).itemId,
        kind: 'question',
        response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['medium'] }] },
        fence: FENCE,
        commit: async () => {
          throw new Error('save failed')
        }
      })
    ).rejects.toThrow('save failed')
    connection.notify({ type: 'settings_updated', settings: { interactionMode: 'auto' } })
    expect(h.lifecycle).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ providerPicks: { planMode: 'false' } })
    )
  })

  it.each(['dismiss', 'stop'] as const)(
    'sends cancel when permissions are abandoned by %s',
    async (action) => {
      const { h, connection, turn } = await planApproval()
      await h.adapter.dispatch({
        sessionId: DROID_RIG_SESSION,
        clientMessageId: 'send-plan',
        body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'make the plan' }] },
        fence: FENCE
      })
      const { answer } = playUntilAsk(connection, turn)
      await choose(h, (await openApproval(h)).itemId, 'proceed_once')
      const permissions = await openPermissions(h)
      await (action === 'stop'
        ? h.adapter.cancelTurn({ sessionId: DROID_RIG_SESSION, fence: FENCE })
        : h.adapter.dismissPrompt?.({
            sessionId: DROID_RIG_SESSION,
            itemId: permissions.itemId,
            fence: FENCE,
            answer: true,
            commit: async () => {}
          }))
      await expect(answer).resolves.toEqual({ selectedOption: 'cancel' })
    }
  )

  it('sends Droid its refusal when the person dismisses the plan, and the turn goes on without it', async () => {
    const turn = await readDroidTurn('spec-plan-approval-off', 'spec-plan')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' })
    const { connection } = await h.start()
    const { answer, rest } = playUntilAsk(connection, turn)
    const card = await openApproval(h)

    await h.adapter.dismissPrompt?.({
      sessionId: DROID_RIG_SESSION,
      itemId: card.itemId,
      fence: FENCE,
      answer: true,
      commit: async () => {}
    })

    await expect(answer).resolves.toEqual({ selectedOption: 'cancel' })
    playSteps(connection, rest)
    await vi.waitFor(async () => {
      const tools = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'tool-call' ? [body] : []
      )
      expect(tools).toMatchObject([{ name: 'ExitSpecMode', state: 'failed' }])
    })
  })

  it('answers Droid with its refusal and settles the card when the person presses Stop', async () => {
    const turn = await readDroidTurn('spec-plan-approval-off', 'spec-plan')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' })
    const { connection } = await h.start()
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'send-1',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'make the plan' }] },
      fence: FENCE
    })
    const { answer } = playUntilAsk(connection, turn)
    let heard: unknown
    void answer.then((reply) => (heard = reply))
    await openApproval(h)

    await expect(
      h.adapter.cancelTurn({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    ).resolves.toMatchObject({ cancelled: true })

    await vi.waitFor(() => expect(heard).toEqual({ selectedOption: 'cancel' }))
    await vi.waitFor(async () => {
      const states = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'approval' ? [body.resolution.state] : []
      )
      expect(states).toEqual(['cancelled'])
    })
  })

  it("takes a card's own Cancel as a dismissal, not a Stop of the whole turn", async () => {
    const turn = await readDroidTurn('spec-plan-approval-off', 'spec-plan')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' })
    const { connection } = await h.start()
    playUntilAsk(connection, turn)
    const card = await openApproval(h)
    const host: StructuredAgentSessionAdapter = h.adapter

    expect(host.routePromptCancel?.({ sessionId: DROID_RIG_SESSION, prompt: card.body })).toEqual({
      kind: 'dismiss'
    })
  })

  it('refuses a choice the card did not offer, and keeps the card waiting', async () => {
    const turn = await readDroidTurn('autonomy-off-exec-and-patch', 'exec')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' })
    const { connection } = await h.start()
    const { answer } = playUntilAsk(connection, turn)
    const card = await openApproval(h)
    const commit = vi.fn(async () => {})

    await expect(choose(h, card.itemId, 'proceed_edit', commit)).rejects.toThrow(
      /one of the options Droid offered/
    )
    expect(commit).not.toHaveBeenCalled()

    await choose(h, card.itemId, 'cancel')
    await expect(answer).resolves.toEqual({ selectedOption: 'cancel' })
  })
})
