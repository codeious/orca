import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  DroidJsonRpcPeer,
  type DroidPeerHandlers,
  type DroidPeerOptions
} from './droid-json-rpc-peer'
import {
  DroidConnectionClosedError,
  DroidRequestTimeoutError,
  DroidRpcError
} from './droid-rpc-errors'

type Frame = Record<string, unknown>

function connect(handlers: DroidPeerHandlers = {}, options: DroidPeerOptions = {}) {
  const fromDroid = new PassThrough()
  const toDroid = new PassThrough()
  const written: Frame[] = []
  let pending = ''
  toDroid.setEncoding('utf8')
  toDroid.on('data', (chunk: string) => {
    pending += chunk
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      written.push(JSON.parse(pending.slice(0, end)))
      pending = pending.slice(end + 1)
    }
  })
  const peer = new DroidJsonRpcPeer(fromDroid, toDroid, handlers, options)
  const say = (frame: Frame) => fromDroid.write(`${JSON.stringify(frame)}\n`)
  return { peer, written, say, fromDroid, toDroid }
}

const STAMP = {
  jsonrpc: '2.0',
  type: 'response',
  factoryApiVersion: '1.0.0',
  factoryProtocolVersion: '1.269.0'
} as const

describe('what Droid sends on its own', () => {
  it('hands a notification to its handler with the method and params', async () => {
    const onNotification = vi.fn()
    const { say } = connect({ onNotification })
    const params = { notification: { type: 'droid_working_state_changed', newState: 'idle' } }

    say({ jsonrpc: '2.0', type: 'notification', method: 'droid.session_notification', params })

    await vi.waitFor(() =>
      expect(onNotification).toHaveBeenCalledWith('droid.session_notification', params)
    )
  })

  it('answers a request with its handler result, stamped, under the id it came with', async () => {
    const onRequest = vi.fn(async () => ({ selectedOption: 'proceed_once' }))
    const { written, say } = connect({ onRequest })

    say({
      jsonrpc: '2.0',
      type: 'request',
      id: 'cli-7',
      method: 'droid.request_permission',
      params: { toolUses: [] }
    })

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toEqual({
      ...STAMP,
      id: 'cli-7',
      result: { selectedOption: 'proceed_once' }
    })
    expect(onRequest).toHaveBeenCalledWith(
      'droid.request_permission',
      { toolUses: [] },
      { id: 'cli-7', signal: expect.any(AbortSignal) }
    )
  })

  it('says it has no such method when nothing handles a request, so Droid never waits on it', async () => {
    const { written, say } = connect()

    say({ jsonrpc: '2.0', type: 'request', id: 'cli-1', method: 'droid.ask_user', params: {} })

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toEqual({
      ...STAMP,
      id: 'cli-1',
      error: { code: -32601, message: 'Method not found' }
    })
  })

  it('answers a handler that throws: its own code if it is a Droid error, else an internal one', async () => {
    const failures = [new DroidRpcError(-32602, 'Bad params'), new Error('private /home/dev path')]
    const onRequest = vi.fn(() => {
      throw failures.shift()
    })
    const { written, say } = connect({ onRequest })

    say({ jsonrpc: '2.0', type: 'request', id: 'a', method: 'droid.pick_options', params: {} })
    say({ jsonrpc: '2.0', type: 'request', id: 'b', method: 'droid.pick_options', params: {} })

    await vi.waitFor(() => expect(written).toHaveLength(2))
    expect(written).toEqual([
      { ...STAMP, id: 'a', error: { code: -32602, message: 'Bad params' } },
      { ...STAMP, id: 'b', error: { code: -32603, message: 'Internal error' } }
    ])
  })

  it('turns away a request past the number it will hold open', async () => {
    const release: (() => void)[] = []
    const onRequest = vi.fn(() => new Promise<null>((resolve) => release.push(() => resolve(null))))
    const { written, say } = connect({ onRequest }, { maxIncomingRequests: 1 })

    say({ jsonrpc: '2.0', type: 'request', id: 'held', method: 'droid.ask_user', params: {} })
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1))
    say({ jsonrpc: '2.0', type: 'request', id: 'extra', method: 'droid.ask_user', params: {} })

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ id: 'extra', error: { code: -32000 } })
    release[0]()
    await vi.waitFor(() => expect(written).toHaveLength(2))
    expect(written[1]).toMatchObject({ id: 'held', result: null })
  })
})

describe('the end of the connection', () => {
  it('rejects every open request and any later one, and reports the close once', async () => {
    const onClose = vi.fn()
    const { peer } = connect({ onClose })
    const open = peer.request('droid.add_user_message', {})

    peer.close()
    peer.close()

    await expect(open).rejects.toBeInstanceOf(DroidConnectionClosedError)
    await expect(peer.request('droid.interrupt_session', {})).rejects.toBeInstanceOf(
      DroidConnectionClosedError
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(peer.closed).toBe(true)
  })

  it('aborts the signal of a request Droid still waits on', async () => {
    let signal: AbortSignal | undefined
    const { peer, say } = connect({
      onRequest: (_method, _params, context) => {
        signal = context.signal
        return new Promise(() => undefined)
      }
    })
    say({ jsonrpc: '2.0', type: 'request', id: 'q', method: 'droid.ask_user', params: {} })
    await vi.waitFor(() => expect(signal).toBeDefined())

    peer.close()

    expect(signal?.aborted).toBe(true)
  })

  it('closes when Droid stops writing, unless a process owner is the one to say it exited', async () => {
    const closing = connect({ onClose: vi.fn() })
    const waiting = connect({ onClose: vi.fn() }, { closeOnInputEnd: false })

    closing.fromDroid.end()
    waiting.fromDroid.end()

    await vi.waitFor(() => expect(closing.peer.closed).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(waiting.peer.closed).toBe(false)
  })

  it('closes when it can no longer write to Droid', async () => {
    const onClose = vi.fn()
    const { toDroid } = connect({ onClose })

    toDroid.destroy()

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on a line over the size limit rather than lose a frame it cannot read', async () => {
    const onClose = vi.fn()
    const { peer, fromDroid } = connect({ onClose }, { maxLineBytes: 64 })
    const open = peer.request('droid.add_user_message', {})
    const rejected = expect(open).rejects.toThrow('over the size limit')

    fromDroid.write(`${JSON.stringify({ filler: 'x'.repeat(200) })}\n`)

    await rejected
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('input that is not a frame', () => {
  it('is ignored without its content reaching a diagnostic, and the next frame still lands', async () => {
    const onDiagnostic = vi.fn()
    const { peer, written, fromDroid, say } = connect({ onDiagnostic })
    const reply = peer.request('droid.list_models', {})
    await vi.waitFor(() => expect(written).toHaveLength(1))

    fromDroid.write('not json /home/dev/secret\n')
    say({ jsonrpc: '2.0', id: 42, method: 7 })
    say({ jsonrpc: '2.0', type: 'response', id: written[0].id, result: 'ok' })

    await expect(reply).resolves.toBe('ok')
    expect(onDiagnostic).toHaveBeenCalled()
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('secret')
  })

  it.each([
    ['neither a result nor an error', {}],
    ['both a result and an error', { result: 1, error: { code: 1, message: 'm' } }]
  ])(
    'rejects the request a response with %s answers, rather than leave it open',
    async (_, body) => {
      const { peer, written, say } = connect()
      const reply = peer.request('droid.list_models', {})
      await vi.waitFor(() => expect(written).toHaveLength(1))

      say({ jsonrpc: '2.0', type: 'response', id: written[0].id, ...body })

      await expect(reply).rejects.toThrow('invalid response')
    }
  )
})

describe('a request to Droid', () => {
  it('goes out stamped as the protocol wants it, and resolves with its response result', async () => {
    const { peer, written, say } = connect()

    const reply = peer.request('droid.add_user_message', { text: 'hi' })
    await vi.waitFor(() => expect(written).toHaveLength(1))

    expect(written[0]).toEqual({
      jsonrpc: '2.0',
      type: 'request',
      factoryApiVersion: '1.0.0',
      factoryProtocolVersion: '1.269.0',
      id: expect.any(String),
      method: 'droid.add_user_message',
      params: { text: 'hi' }
    })
    say({ jsonrpc: '2.0', type: 'response', id: written[0].id, result: { accepted: true } })
    await expect(reply).resolves.toEqual({ accepted: true })
  })

  it('gives each request its own string id and settles each by its own', async () => {
    const { peer, written, say } = connect()

    const first = peer.request('droid.list_models', {})
    const second = peer.request('droid.interrupt_session', {})
    await vi.waitFor(() => expect(written).toHaveLength(2))
    const [a, b] = written.map((frame) => frame.id)
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)

    say({ jsonrpc: '2.0', type: 'response', id: b, result: 'second' })
    say({ jsonrpc: '2.0', type: 'response', id: a, result: 'first' })
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
  })

  it('rejects with the error Droid answered, keeping its code and message', async () => {
    const { peer, written, say } = connect()

    const reply = peer.request('droid.load_session', { sessionId: 'gone' })
    await vi.waitFor(() => expect(written).toHaveLength(1))
    say({
      jsonrpc: '2.0',
      type: 'response',
      id: written[0].id,
      error: { code: -32602, message: 'Session not found' }
    })

    await expect(reply).rejects.toMatchObject({
      name: 'DroidRpcError',
      code: -32602,
      message: 'Session not found'
    })
    await expect(reply).rejects.toBeInstanceOf(DroidRpcError)
  })

  it('rejects when no answer comes within the time it was given', async () => {
    const { peer } = connect({}, { requestTimeoutMs: 20 })

    await expect(peer.request('droid.add_user_message', {})).rejects.toBeInstanceOf(
      DroidRequestTimeoutError
    )
  })
})
