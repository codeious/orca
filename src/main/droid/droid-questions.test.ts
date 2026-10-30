import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  boundJournalPromptBody,
  MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS
} from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import { pendingDroidResolution } from './droid-prompt-presentation'
import {
  askAsDroid,
  playUntilAsk,
  readDroidTurn,
  type DroidRecordedStep
} from './droid-recording.test-support'

afterEach(runDroidRigCleanups)

const FENCE = 7

// Frames follow the SDK's AskUser schema; the multi-select request is the one Droid 0.251.0 sent.
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

function openQuestion(h: DroidAdapterRig, firstQuestionId = 'q1') {
  return vi.waitFor(async () => {
    for (const { itemId, body } of await h.rig.rows()) {
      if (body.kind === 'question' && body.questions?.[0]?.id === firstQuestionId) {
        return { itemId, body }
      }
    }
    throw new Error(`No question card starting at ${firstQuestionId} yet`)
  })
}

function numberedQuestions(count: number) {
  return Array.from({ length: count }, (_, position) => ({
    index: position + 1,
    topic: `T${position + 1}`,
    question: `Question ${position + 1}?`,
    options: ['yes', 'no']
  }))
}

/** Answers the card with `choice` (an option id) on each of the question ids it asks. */
function answerCard(
  h: DroidAdapterRig,
  itemId: string,
  questionIds: readonly string[],
  choice = 'o1'
): Promise<void> {
  return h.adapter.answerPrompt({
    sessionId: DROID_RIG_SESSION,
    itemId,
    kind: 'question',
    response: {
      kind: 'answers',
      answers: questionIds.map((questionId) => ({ questionId, optionIds: [choice] }))
    },
    fence: FENCE,
    commit: async () => {}
  })
}

const askParams = z.looseObject({ questions: z.array(z.looseObject({})) })

/** The recorded ask with `change` applied to each of its questions. */
function changeRecordedQuestions(
  steps: DroidRecordedStep[],
  change: (question: Record<string, unknown>) => Record<string, unknown>
): DroidRecordedStep[] {
  return steps.map((step) => {
    if (step.kind !== 'ask') {
      return step
    }
    const params = askParams.parse(step.params)
    return { ...step, params: { ...params, questions: params.questions.map(change) } }
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

  it('shows five questions on two cards and answers Droid once, with an answer for each', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    let heard = false
    const answer = askAsDroid(connection, 'droid.ask_user', {
      toolCallId: 'call-3',
      questions: numberedQuestions(5)
    })
    void answer.then(
      () => (heard = true),
      () => (heard = true)
    )

    const first = await openQuestion(h)
    expect(first.body).toMatchObject({
      question: 'Question 1?',
      questions: [
        { id: 'q1', header: 'T1' },
        { id: 'q2', header: 'T2' },
        { id: 'q3', header: 'T3' },
        { id: 'q4', header: 'T4' }
      ]
    })
    await answerCard(h, first.itemId, ['q1', 'q2', 'q3', 'q4'])

    const second = await openQuestion(h, 'q5')
    expect(second.body).toMatchObject({
      question: 'Question 5?',
      questions: [{ id: 'q5', header: 'T5' }],
      resolution: { state: 'pending' }
    })
    expect(heard).toBe(false)
    await answerCard(h, second.itemId, ['q5'], 'o2')

    await expect(answer).resolves.toEqual({
      answers: [
        { index: 1, question: 'Question 1?', answer: 'yes' },
        { index: 2, question: 'Question 2?', answer: 'yes' },
        { index: 3, question: 'Question 3?', answer: 'yes' },
        { index: 4, question: 'Question 4?', answer: 'yes' },
        { index: 5, question: 'Question 5?', answer: 'no' }
      ]
    })
  })

  it('keeps asking in groups of four until all nine questions have an answer', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', {
      toolCallId: 'call-4',
      questions: numberedQuestions(9)
    })

    await answerCard(h, (await openQuestion(h)).itemId, ['q1', 'q2', 'q3', 'q4'])
    const middle = await openQuestion(h, 'q5')
    expect(middle.body).toMatchObject({
      questions: [{ id: 'q5' }, { id: 'q6' }, { id: 'q7' }, { id: 'q8' }]
    })
    await answerCard(h, middle.itemId, ['q5', 'q6', 'q7', 'q8'])
    const last = await openQuestion(h, 'q9')
    expect(last.body).toMatchObject({ questions: [{ id: 'q9', header: 'T9' }] })
    await answerCard(h, last.itemId, ['q9'])

    await expect(answer).resolves.toMatchObject({
      answers: Array.from({ length: 9 }, (_, position) => ({ index: position + 1, answer: 'yes' }))
    })
  })

  it('refuses a card that skips a question and opens no further card', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', {
      toolCallId: 'call-5',
      questions: numberedQuestions(5)
    })
    const first = await openQuestion(h)

    await expect(answerCard(h, first.itemId, ['q1', 'q2', 'q3'])).rejects.toThrow(
      /Answer every question/
    )
    expect(
      (await h.rig.rows()).some(
        ({ body }) => body.kind === 'question' && body.questions?.[0]?.id === 'q5'
      )
    ).toBe(false)

    await h.adapter.dismissPrompt?.({
      sessionId: DROID_RIG_SESSION,
      itemId: first.itemId,
      fence: FENCE,
      answer: true,
      commit: async () => {}
    })
    await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
  })

  it('tells Droid the questionnaire was cancelled when a later card is dismissed, whatever was answered', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const answer = askAsDroid(connection, 'droid.ask_user', {
      toolCallId: 'call-6',
      questions: numberedQuestions(5)
    })
    await answerCard(h, (await openQuestion(h)).itemId, ['q1', 'q2', 'q3', 'q4'])
    const second = await openQuestion(h, 'q5')

    await h.adapter.dismissPrompt?.({
      sessionId: DROID_RIG_SESSION,
      itemId: second.itemId,
      fence: FENCE,
      answer: true,
      commit: async () => {}
    })

    await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
  })

  it('takes a later card away when the connection closes under it', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    const closing = new AbortController()
    const answer = askAsDroid(
      connection,
      'droid.ask_user',
      { toolCallId: 'call-7', questions: numberedQuestions(5) },
      'ask-7',
      closing.signal
    )
    await answerCard(h, (await openQuestion(h)).itemId, ['q1', 'q2', 'q3', 'q4'])
    await openQuestion(h, 'q5')

    closing.abort()

    await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
    await vi.waitFor(async () => {
      const laterStates = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'question' && body.questions?.[0]?.id === 'q5' ? [body.resolution.state] : []
      )
      expect(laterStates).toEqual(['cancelled'])
    })
  })

  it('keeps the grouped-question cap at four for every agent that shares it', () => {
    expect(MAX_JOURNAL_GROUPED_PROMPT_QUESTIONS).toBe(4)
    const body = boundJournalPromptBody({
      kind: 'question',
      question: 'Question 1?',
      options: [],
      questions: numberedQuestions(5).map(({ index, question, options }) => ({
        id: `q${index}`,
        question,
        multiSelect: false,
        options: options.map((label, choice) => ({ id: `o${choice + 1}`, label }))
      })),
      resolution: pendingDroidResolution
    })
    expect(body.questions?.map(({ id }) => id)).toEqual(['q1', 'q2', 'q3', 'q4'])
  })

  describe('the multi-select question Droid sent', () => {
    async function askRecordedQuestion(change = (question: Record<string, unknown>) => question) {
      const h = await setupDroidAdapter()
      const { connection } = await h.start()
      const recorded = await readDroidTurn('ask-user-multiselect', 'ask-user-multiselect')
      const { answer } = playUntilAsk(connection, changeRecordedQuestions(recorded, change))
      return { h, answer, card: await openQuestion(h) }
    }

    it('lets the person pick several options and answers Droid with every one picked', async () => {
      const { h, answer, card } = await askRecordedQuestion()
      expect(card.body).toMatchObject({
        question: 'Which colors do you like?',
        options: [
          { id: 'o1', label: 'red' },
          { id: 'o2', label: 'green' },
          { id: 'o3', label: 'blue' }
        ],
        questions: [{ id: 'q1', header: 'Colors', multiSelect: true }]
      })

      await h.adapter.answerPrompt({
        sessionId: DROID_RIG_SESSION,
        itemId: card.itemId,
        kind: 'question',
        response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['o1', 'o3'] }] },
        fence: FENCE,
        commit: async () => {}
      })

      await expect(answer).resolves.toEqual({
        answers: [{ index: 1, question: 'Which colors do you like?', answer: 'red, blue' }]
      })
    })

    it('answers Droid with the cancel it recorded when the card is dismissed', async () => {
      const { h, answer, card } = await askRecordedQuestion()

      await h.adapter.dismissPrompt?.({
        sessionId: DROID_RIG_SESSION,
        itemId: card.itemId,
        fence: FENCE,
        answer: true,
        commit: async () => {}
      })

      await expect(answer).resolves.toEqual({ cancelled: true, answers: [] })
    })

    it('answers it as a plain question when Droid also sends a workstream proposal', async () => {
      const { h, answer, card } = await askRecordedQuestion((question) => ({
        ...question,
        workstreamProposal: { title: 'Ship the importer' }
      }))
      expect(JSON.stringify(card.body)).not.toMatch(/workstream|Ship the importer/i)
      expect(card.body).toMatchObject({ question: 'Which colors do you like?' })

      await h.adapter.answerPrompt({
        sessionId: DROID_RIG_SESSION,
        itemId: card.itemId,
        kind: 'question',
        response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['o2'] }] },
        fence: FENCE,
        commit: async () => {}
      })

      await expect(answer).resolves.toEqual({
        answers: [{ index: 1, question: 'Which colors do you like?', answer: 'green' }]
      })
    })
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
