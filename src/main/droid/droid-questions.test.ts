import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import { askAsDroid } from './droid-recording.test-support'

afterEach(runDroidRigCleanups)

const FENCE = 7

// No recording of Droid's ask_user exists, so these frames follow the SDK's AskUser schema.
const RUNNER_QUESTION = {
  toolCallId: 'call-1',
  questions: [
    {
      index: 0,
      topic: 'Runner',
      question: 'Which test runner?',
      options: ['vitest', 'jest']
    }
  ]
}

function openQuestion(h: DroidAdapterRig) {
  return vi.waitFor(async () => {
    for (const { itemId, body } of await h.rig.rows()) {
      if (body.kind === 'question') {
        return { itemId, body }
      }
    }
    throw new Error('No question card yet')
  })
}

describe('Droid ask_user cards', () => {
  it("puts Droid's question on a card and answers Droid with the option chosen", async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', RUNNER_QUESTION)

    const card = await openQuestion(h)
    expect(card.body).toMatchObject({
      kind: 'question',
      question: 'Which test runner?',
      options: [
        { id: 'o1', label: 'vitest' },
        { id: 'o2', label: 'jest' }
      ],
      questions: [{ id: 'q1', header: 'Runner', multiSelect: false }],
      resolution: { state: 'pending' }
    })
    await h.adapter.answerPrompt({
      sessionId: DROID_RIG_SESSION,
      itemId: card.itemId,
      kind: 'question',
      response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['o2'] }] },
      fence: FENCE,
      commit: async () => {}
    })

    await expect(answer).resolves.toEqual({
      answers: [{ index: 0, question: 'Which test runner?', answer: 'jest' }]
    })
  })

  it('answers each of several questions, a multi-select as a list and a typed reply as it was typed', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', {
      toolCallId: 'call-2',
      questions: [
        {
          index: 0,
          topic: 'Checks',
          question: 'Which checks?',
          options: ['lint', 'types', 'unit'],
          multiSelect: true
        },
        { index: 1, topic: 'Branch', question: 'Which branch?', options: ['main', 'dev'] }
      ]
    })
    const card = await openQuestion(h)

    await h.adapter.answerPrompt({
      sessionId: DROID_RIG_SESSION,
      itemId: card.itemId,
      kind: 'question',
      response: {
        kind: 'answers',
        answers: [
          { questionId: 'q1', optionIds: ['o1', 'o3'] },
          { questionId: 'q2', optionIds: [], other: ' release/2.0 ' }
        ]
      },
      fence: FENCE,
      commit: async () => {}
    })

    await expect(answer).resolves.toEqual({
      answers: [
        { index: 0, question: 'Which checks?', answer: 'lint, unit' },
        { index: 1, question: 'Which branch?', answer: 'release/2.0' }
      ]
    })
  })

  it('tells Droid the questionnaire was cancelled when the person dismisses the card', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', RUNNER_QUESTION)
    const card = await openQuestion(h)

    await h.adapter.dismissPrompt?.({
      sessionId: DROID_RIG_SESSION,
      itemId: card.itemId,
      fence: FENCE,
      answer: true,
      commit: async () => {}
    })

    await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
  })

  it('refuses an answer that skips a question, and keeps the card waiting', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', RUNNER_QUESTION)
    const card = await openQuestion(h)
    const commit = vi.fn(async () => {})

    await expect(
      h.adapter.answerPrompt({
        sessionId: DROID_RIG_SESSION,
        itemId: card.itemId,
        kind: 'question',
        response: { kind: 'answers', answers: [] },
        fence: FENCE,
        commit
      })
    ).rejects.toThrow(/Answer every question/)
    expect(commit).not.toHaveBeenCalled()

    await h.adapter.dismissPrompt?.({
      sessionId: DROID_RIG_SESSION,
      itemId: card.itemId,
      fence: FENCE,
      answer: true,
      commit: async () => {}
    })
    await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
  })

  it('tells Droid at once when it asks more questions than a card can show', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const questions = Array.from({ length: 5 }, (_, index) => ({
      index,
      topic: `T${index}`,
      question: `Question ${index}?`,
      options: ['yes', 'no']
    }))

    await expect(
      askAsDroid(connection, 'droid.ask_user', { toolCallId: 'call-3', questions })
    ).rejects.toMatchObject({ code: -32602 })
    expect((await h.rig.rows()).some(({ body }) => body.kind === 'question')).toBe(false)
  })

  it('takes the card away when the connection closes under it', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const closing = new AbortController()
    const answer = askAsDroid(
      connection,
      'droid.ask_user',
      RUNNER_QUESTION,
      'ask-9',
      closing.signal
    )
    await openQuestion(h)

    closing.abort()

    await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
    await vi.waitFor(async () => {
      const states = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'question' ? [body.resolution.state] : []
      )
      expect(states).toEqual(['cancelled'])
    })
  })
})
