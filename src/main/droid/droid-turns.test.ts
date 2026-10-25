import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import {
  closeProviderTimelineRigs,
  messageText,
  openProviderTimelineRig
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { DroidRpcError } from './droid-rpc-errors'
import { DroidTurns } from './droid-turns'

const pending: (() => void)[] = []
afterEach(async () => {
  pending.splice(0).forEach((end) => end())
  await closeProviderTimelineRigs()
})

type Request = (
  method: string,
  params: unknown,
  options?: { timeoutMs?: number | null; onId?: (id: string) => void }
) => Promise<unknown>

async function setup(reply: () => Promise<unknown> = async () => ({})) {
  const rig = await openProviderTimelineRig({ agent: 'droid', sessionId: 'session-timeline' })
  const accepted = vi.fn(),
    failed = vi.fn(),
    idle = vi.fn(),
    settled = vi.fn()
  const lane = new JsonlRpcTimelineLane({
    sink: rig.sink,
    sessionId: 'session-timeline',
    agent: 'droid',
    generation: 'generation-1',
    namespace: 'session-timeline',
    pauseReading: vi.fn(),
    resumeReading: vi.fn(),
    onInputAccepted: accepted,
    onFailed: failed
  })
  let ids = 0
  const request = vi.fn<Request>(async (_method, _params, options) => {
    options?.onId?.(`orca-${++ids}`)
    return reply()
  })
  const turns = new DroidTurns({ lane, generation: 'generation-1', request, settled, idle })
  pending.push(() => {
    turns.end()
    lane.dispose()
  })
  const notify = (notification: Record<string, unknown>) =>
    turns.receive({ sessionId: 'droid-session-1', notification })
  const working = (newState: string) => notify({ type: 'droid_working_state_changed', newState })
  const echo = (text: string, requestId?: string, extra: Record<string, unknown> = {}) =>
    notify({
      type: 'create_message',
      message: {
        id: `user-${text}`,
        role: 'user',
        content: [{ type: 'text', text }],
        ...extra
      },
      ...(requestId ? { requestId } : {})
    })
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
    lane.flush()
  }
  return {
    rig,
    lane,
    turns,
    request,
    accepted,
    failed,
    idle,
    settled,
    notify,
    working,
    echo,
    flush
  }
}

const assistantRows = async (h: Awaited<ReturnType<typeof setup>>) =>
  (await h.rig.rows()).flatMap(({ body }) =>
    body.kind === 'message' && body.role === 'assistant' ? [messageText(body)] : []
  )

describe('a send and the turn it opens', () => {
  it("is admitted on Droid's receipt and accepted only by the echo that carries its request id", async () => {
    const h = await setup()

    expect(await h.turns.submit('send-1', 100, { text: 'hello' })).toEqual({ state: 'admitted' })
    expect(h.request).toHaveBeenCalledWith(
      'droid.add_user_message',
      { text: 'hello' },
      expect.objectContaining({ onId: expect.any(Function) })
    )
    expect(h.turns.holdsDispatch).toBe(true)
    h.working('streaming_assistant_message')
    h.echo('', undefined, { visibility: 'llm_only' })
    h.echo('hello', 'someone-elses-id')
    await h.flush()
    expect(h.accepted).not.toHaveBeenCalled()

    h.echo('hello', 'orca-1')
    await h.flush()

    expect(h.accepted).toHaveBeenCalledExactlyOnceWith('send-1')
    expect(h.turns.holdsDispatch).toBe(false)
  })

  it('is accepted by an echo that beats the receipt', async () => {
    const receipt = Promise.withResolvers<unknown>()
    const h = await setup(() => receipt.promise)

    const sent = h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('streaming_assistant_message')
    h.echo('hello', 'orca-1')
    receipt.resolve({})
    await sent
    await h.flush()

    expect(h.accepted).toHaveBeenCalledExactlyOnceWith('send-1')
  })

  it("is rejected with Droid's own words when Droid refuses it, and holds nothing", async () => {
    const h = await setup(async () => {
      throw new DroidRpcError(-32602, 'Session is closed')
    })

    const outcome = await h.turns.submit('send-1', 100, { text: 'hello' })

    expect(outcome).toMatchObject({ state: 'rejected' })
    expect(h.turns.holdsDispatch).toBe(false)
  })

  it('is unknown, never re-sent, when the connection ends before Droid answers', async () => {
    const h = await setup(async () => {
      throw new Error('Droid process exited')
    })

    expect(await h.turns.submit('send-1', 100, { text: 'hello' })).toMatchObject({
      state: 'unknown'
    })
  })

  it('opens a turn when Droid leaves idle and settles it when the turn completes', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })

    h.working('thinking')
    await h.flush()
    expect((await h.rig.turns())[0]?.state).toBe('running')
    h.notify({ type: 'agent_turn_completed', reason: 'completed', turnId: 'turn-1' })
    h.working('idle')
    await h.flush()

    const [turn] = await h.rig.turns()
    expect(turn).toMatchObject({ state: 'completed', outcome: 'success' })
    expect(await h.rig.turns()).toHaveLength(1)
    expect(h.idle).toHaveBeenCalledTimes(1)
  })

  it('settles the sends Droid never echoed when the child ends', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })

    h.turns.end()

    expect(h.settled).toHaveBeenCalledWith('send-1', expect.objectContaining({ state: 'unknown' }))
  })
})

describe('what Droid writes in a turn', () => {
  it('streams assistant text and writes it once, whether or not the snapshot repeats it', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('streaming_assistant_message')
    h.echo('hello', 'orca-1')

    h.notify({ type: 'assistant_text_delta', messageId: 'm-1', blockIndex: 1, textDelta: 'Hel' })
    h.notify({ type: 'assistant_text_delta', messageId: 'm-1', blockIndex: 1, textDelta: 'lo' })
    h.notify({ type: 'assistant_text_complete', messageId: 'm-1', blockIndex: 1 })
    h.notify({
      type: 'create_message',
      message: {
        id: 'm-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Hello' }
        ]
      }
    })
    h.notify({ type: 'agent_turn_completed', reason: 'completed', turnId: 'turn-1' })
    await h.flush()

    expect(await assistantRows(h)).toEqual(['Hello'])
  })

  it('writes an assistant message that arrives only as a snapshot', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('streaming_assistant_message')

    h.notify({
      type: 'create_message',
      message: { id: 'm-2', role: 'assistant', content: [{ type: 'text', text: 'STEERED' }] }
    })
    h.notify({ type: 'agent_turn_completed', reason: 'completed', turnId: 'turn-1' })
    await h.flush()

    expect(await assistantRows(h)).toEqual(['STEERED'])
  })

  it('writes one row per tool call: its growing input, then its result', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('executing_tool')

    h.notify({ type: 'tool_call', toolUse: { id: 'call-1', name: 'Execute', input: {} } })
    h.notify({
      type: 'tool_call',
      toolUse: { id: 'call-1', name: 'Execute', input: { command: 'echo STEP1' } }
    })
    h.notify({
      type: 'tool_execution_phase_changed',
      toolUseId: 'call-1',
      toolName: 'Execute',
      phase: 'executing'
    })
    await h.flush()
    const running = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'tool-call' ? [body] : []
    )
    expect(running).toHaveLength(1)
    expect(running[0]).toMatchObject({ callId: 'call-1', state: 'running' })
    expect(running[0]?.input).toEqual({ command: 'echo STEP1' })

    h.notify({ type: 'tool_result', toolUseId: 'call-1', content: 'STEP1\n', isError: false })
    await h.flush()

    const settled = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'tool-call' ? [body] : []
    )
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({
      name: 'Execute',
      state: 'completed',
      input: { command: 'echo STEP1' },
      output: { head: 'STEP1\n', truncated: false }
    })
  })

  it('marks a tool call failed when Droid says its result is an error', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('executing_tool')

    h.notify({ type: 'tool_call', toolUse: { id: 'call-1', name: 'Execute', input: { a: 1 } } })
    h.notify({ type: 'tool_result', toolUseId: 'call-1', content: 'boom', isError: true })
    await h.flush()

    const [tool] = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'tool-call' ? [body] : []
    )
    expect(tool).toMatchObject({ state: 'failed', output: { head: 'boom' } })
  })

  it('ignores a notification it has no use for, and a type it has never seen', async () => {
    const h = await setup()

    h.notify({ type: 'mcp_status_changed', servers: [] })
    h.notify({ type: 'session_title_updated', title: 'say hi' })
    h.notify({ type: 'a_type_from_a_later_droid', anything: 1 })
    await h.flush()

    expect(h.failed).not.toHaveBeenCalled()
    expect(await h.rig.turns()).toHaveLength(0)
  })

  it('fails the child on a notification it reads but cannot make sense of', async () => {
    const h = await setup()

    expect(() => h.notify({ type: 'assistant_text_delta', messageId: 'm-1' })).toThrow(
      'Invalid Droid notification'
    )
  })
})

describe('how a turn ends', () => {
  it("is a failure carrying Droid's text when the model rejected the sign-in", async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('streaming_assistant_message')
    h.echo('hello', 'orca-1')
    h.working('thinking')

    h.notify({
      type: 'error',
      message: 'No access token available',
      errorType: 'Error',
      error: { name: 'AuthenticationError', message: 'No access token available' }
    })
    h.notify({ type: 'agent_turn_completed', reason: 'model_authentication_failed', turnId: 't' })
    h.working('idle')
    await h.flush()

    const failures = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'status' && body.failure ? [body] : []
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]?.failure).toMatchObject({
      kind: 'notSignedIn',
      detail: { text: 'No access token available', audience: 'person' }
    })
    expect(failures[0]?.text).toContain('No access token available')
    expect((await h.rig.turns())[0]).toMatchObject({ state: 'completed', outcome: 'failure' })
  })

  it('is a failure with the error Droid last reported for any other fault', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('thinking')

    h.notify({ type: 'error', message: 'Provider is unreachable', errorType: 'Error' })
    h.notify({ type: 'agent_turn_completed', reason: 'model_provider_unreachable', turnId: 't' })
    await h.flush()

    const failures = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'status' && body.failure ? [body] : []
    )
    expect(failures[0]?.failure).toMatchObject({
      kind: 'providerRejected',
      detail: { text: 'Provider is unreachable' }
    })
    expect((await h.rig.turns())[0]?.outcome).toBe('failure')
  })

  it('is a cancellation after a Stop, and after Droid says the turn was cancelled', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('executing_tool')

    h.turns.stop()
    h.notify({ type: 'agent_turn_completed', reason: 'cancelled', turnId: 't' })
    await h.flush()

    expect((await h.rig.turns())[0]).toMatchObject({
      state: 'interrupted',
      outcome: 'cancellation'
    })
  })

  it('does not write a failure row for a turn that completed', async () => {
    const h = await setup()
    await h.turns.submit('send-1', 100, { text: 'hello' })
    h.working('thinking')

    h.notify({ type: 'agent_turn_completed', reason: 'completed', turnId: 't' })
    await h.flush()

    expect(
      (await h.rig.rows()).filter(({ body }) => body.kind === 'status' && body.failure)
    ).toHaveLength(0)
  })
})
