import { PickOptionsRequestParamsSchema, PickOptionsResultSchema } from '@factory/droid-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import { askAsDroid } from './droid-recording.test-support'

afterEach(runDroidRigCleanups)

const FENCE = 7

// Droid's pick_options was never seen live (its only emitter needs Slack), so these requests are
// built from the SDK's own schema and are not a capture.
function pickRequest(overrides: Record<string, unknown> = {}) {
  return PickOptionsRequestParamsSchema.parse({
    toolCallId: 'call-1',
    title: 'Pick a channel',
    rows: [
      { id: 'C1', label: '#general', detail: 'public' },
      { id: 'C2', label: '#ops' },
      { id: 'C3', label: '#random', detail: 'public' }
    ],
    multi: false,
    preselectedIds: [],
    ...overrides
  })
}

function openPick(h: DroidAdapterRig) {
  return vi.waitFor(async () => {
    for (const { itemId, body } of await h.rig.rows()) {
      if (body.kind === 'question') {
        return { itemId, body }
      }
    }
    throw new Error('No pick card yet')
  })
}

function choose(h: DroidAdapterRig, itemId: string, ...optionIds: string[]) {
  return h.adapter.answerPrompt({
    sessionId: DROID_RIG_SESSION,
    itemId,
    kind: 'question',
    response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds }] },
    fence: FENCE,
    commit: async () => {}
  })
}

function dismiss(h: DroidAdapterRig, itemId: string) {
  return h.adapter.dismissPrompt?.({
    sessionId: DROID_RIG_SESSION,
    itemId,
    fence: FENCE,
    answer: true,
    commit: async () => {}
  })
}

describe('Droid pick_options cards', () => {
  it('shows the title, each row and its detail, and answers Droid with the one row chosen', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.pick_options', pickRequest())

    const card = await openPick(h)
    expect(card.body).toMatchObject({
      kind: 'question',
      question: 'Pick a channel',
      options: [
        { id: 'o1', label: '#general', description: 'public' },
        { id: 'o2', label: '#ops' },
        { id: 'o3', label: '#random', description: 'public' }
      ],
      questions: [{ id: 'q1', multiSelect: false }],
      resolution: { state: 'pending' }
    })
    expect(card.body.options[1]).not.toHaveProperty('description')
    // Nothing the request did not carry: no typed answer, no selection, no search, no note.
    const [asked] = card.body.questions ?? []
    expect(asked).not.toHaveProperty('freeTextQuestionId')
    expect(asked).not.toHaveProperty('preselectedOptionIds')
    expect(asked).not.toHaveProperty('initialSearch')
    expect(asked).not.toHaveProperty('description')
    await choose(h, card.itemId, 'o2')

    // The card has no refresh control, so the reply never carries `refresh` or `cancelled`.
    const reply = await answer
    expect(reply).toStrictEqual({ selectedIds: ['C2'] })
    expect(PickOptionsResultSchema.safeParse(reply).success).toBe(true)
  })

  it('answers Droid with every row chosen on a multi-select, and no other', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.pick_options', pickRequest({ multi: true }))
    const card = await openPick(h)
    expect(card.body.questions?.[0]).toMatchObject({ multiSelect: true })

    await choose(h, card.itemId, 'o1', 'o3')

    await expect(answer).resolves.toStrictEqual({ selectedIds: ['C1', 'C3'] })
  })

  it('refuses two rows on a single-select, and keeps the card waiting', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.pick_options', pickRequest())
    const card = await openPick(h)
    const commit = vi.fn(async () => {})

    await expect(
      h.adapter.answerPrompt({
        sessionId: DROID_RIG_SESSION,
        itemId: card.itemId,
        kind: 'question',
        response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['o1', 'o2'] }] },
        fence: FENCE,
        commit
      })
    ).rejects.toThrow(/rows Droid offered/)
    expect(commit).not.toHaveBeenCalled()

    await dismiss(h, card.itemId)
    await expect(answer).resolves.toStrictEqual({ cancelled: true, selectedIds: [] })
  })

  it('cancels with no row when the card is dismissed, without interrupting Droid, and the next message still goes', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.pick_options', pickRequest({ multi: true }))
    const card = await openPick(h)
    const host: StructuredAgentSessionAdapter = h.adapter

    // A card's own Cancel (Esc) is a dismissal, never the chat's Stop.
    expect(host.routePromptCancel?.({ sessionId: DROID_RIG_SESSION, prompt: card.body })).toEqual({
      kind: 'dismiss'
    })
    await dismiss(h, card.itemId)

    const reply = await answer
    expect(reply).toStrictEqual({ cancelled: true, selectedIds: [] })
    expect(PickOptionsResultSchema.safeParse(reply).success).toBe(true)
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.interrupt_session')
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'send-1',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'carry on' }] },
      fence: FENCE
    })
    expect(connection.requests.map(({ method }) => method)).toContain('droid.add_user_message')
  })

  it('opens the card on the rows the request preselected, and with the search it started with', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(
      connection,
      'droid.pick_options',
      pickRequest({ multi: true, preselectedIds: ['C1', 'C3'], initialSearch: 'gen' })
    )

    const card = await openPick(h)
    expect(card.body.questions?.[0]).toMatchObject({
      preselectedOptionIds: ['o1', 'o3'],
      initialSearch: 'gen'
    })

    await dismiss(h, card.itemId)
    await answer
  })

  it('shows the hint under the title', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(
      connection,
      'droid.pick_options',
      pickRequest({ hint: 'Invite the bot first', emptyText: 'No channels' })
    )

    const card = await openPick(h)
    expect(card.body.questions?.[0]).toMatchObject({ description: 'Invite the bot first' })

    await dismiss(h, card.itemId)
    await answer
  })

  it('shows the empty text instead of the list when there are no rows, and can still be dismissed', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(
      connection,
      'droid.pick_options',
      pickRequest({ rows: [], emptyText: 'No channels', hint: 'Invite the bot first' })
    )

    const card = await openPick(h)
    expect(card.body).toMatchObject({
      options: [],
      questions: [{ options: [], description: 'No channels' }]
    })

    await dismiss(h, card.itemId)
    await expect(answer).resolves.toStrictEqual({ cancelled: true, selectedIds: [] })
  })

  it('preselects only the first listed row on a single-select', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(
      connection,
      'droid.pick_options',
      pickRequest({ preselectedIds: ['C3', 'C1'] })
    )

    const card = await openPick(h)
    expect(card.body.questions?.[0]).toMatchObject({ preselectedOptionIds: ['o3'] })

    await dismiss(h, card.itemId)
    await answer
  })

  it('tells Droid at once when it offers more rows than a card can show', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const rows = Array.from({ length: 65 }, (_, index) => ({
      id: `R${index}`,
      label: `Row ${index}`
    }))

    await expect(
      askAsDroid(connection, 'droid.pick_options', pickRequest({ rows }))
    ).rejects.toMatchObject({
      code: -32602
    })
    expect((await h.rig.rows()).some(({ body }) => body.kind === 'question')).toBe(false)
  })

  it('answers a method it does not present with "not found", and the chat and its picks keep working', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()

    await expect(askAsDroid(connection, 'droid.some_future_picker', {})).rejects.toMatchObject({
      code: -32601
    })

    const answer = askAsDroid(connection, 'droid.pick_options', pickRequest())
    const card = await openPick(h)
    await choose(h, card.itemId, 'o1')
    await expect(answer).resolves.toStrictEqual({ selectedIds: ['C1'] })
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'send-2',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'still here' }] },
      fence: FENCE
    })
    expect(connection.requests.map(({ method }) => method)).toContain('droid.add_user_message')
  })

  it.each(['toolCallId', 'preselectedIds'])(
    'tells Droid at once when the request leaves out %s, which the schema requires',
    async (field) => {
      const h = await setupDroidAdapter()
      const { connection } = await h.start()
      const params = Object.fromEntries(
        Object.entries(pickRequest()).filter(([key]) => key !== field)
      )

      await expect(askAsDroid(connection, 'droid.pick_options', params)).rejects.toMatchObject({
        code: -32602
      })
      expect((await h.rig.rows()).some(({ body }) => body.kind === 'question')).toBe(false)
    }
  )

  it('tells Droid at once when the request is not a pick request', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()

    await expect(
      askAsDroid(connection, 'droid.pick_options', { toolCallId: 'call-1', title: 'Pick' })
    ).rejects.toMatchObject({ code: -32602 })
    expect((await h.rig.rows()).some(({ body }) => body.kind === 'question')).toBe(false)
  })
})
