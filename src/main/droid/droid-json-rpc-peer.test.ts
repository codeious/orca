import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  DroidJsonRpcPeer,
  type DroidPeerHandlers,
  type DroidPeerOptions
} from './droid-json-rpc-peer'
import { DroidConnectionClosedError, DroidRpcError } from './droid-rpc-errors'

type Frame = Record<string, unknown>

function connect(handlers: DroidPeerHandlers = {}, options: DroidPeerOptions = {}) {
  const fromDroid = new PassThrough()
  const toDroid = new PassThrough()
  const written: Frame[] = []
  const lines: string[] = []
  let pending = ''
  toDroid.setEncoding('utf8')
  toDroid.on('data', (chunk: string) => {
    pending += chunk
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      lines.push(pending.slice(0, end))
      written.push(JSON.parse(pending.slice(0, end)))
      pending = pending.slice(end + 1)
    }
  })
  const peer = new DroidJsonRpcPeer(fromDroid, toDroid, handlers, options)
  const say = (frame: Frame) => fromDroid.write(`${JSON.stringify(frame)}\n`)
  return { peer, written, lines, say, fromDroid, toDroid }
}

describe('what Droid sends on its own', () => {
  it('hands a notification to its handler with the method and params', async () => {
    const onNotification = vi.fn()
    const { fromDroid } = connect({ onNotification })
    // Final idle frame from the recorded ask-user-multiselect exchange.
    fromDroid.write(
      '{"jsonrpc":"2.0","type":"notification","factoryApiVersion":"1.0.0","factoryProtocolVersion":"1.279.0","method":"droid.session_notification","params":{"sessionId":"00000000-0000-4000-8000-000000000001","notification":{"type":"droid_working_state_changed","newState":"idle"}}}\n'
    )
    expect(onNotification).toHaveBeenCalledWith('droid.session_notification', {
      sessionId: '00000000-0000-4000-8000-000000000001',
      notification: { type: 'droid_working_state_changed', newState: 'idle' }
    })
  })

  it('starts a request handler before the next line of the same chunk is read', async () => {
    const seen: string[] = []
    const { fromDroid } = connect({
      onRequest: () => {
        seen.push('request')
        return null
      },
      onNotification: () => {
        seen.push('notification')
      }
    })
    const lines = [
      { jsonrpc: '2.0', type: 'request', id: 'cli-1', method: 'droid.request_permission' },
      { jsonrpc: '2.0', type: 'notification', method: 'droid.session_notification' }
    ]

    fromDroid.write(lines.map((line) => `${JSON.stringify(line)}\n`).join(''))

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen).toEqual(['request', 'notification'])
  })

  it('turns away a request past the number it will hold open', async () => {
    const release: (() => void)[] = []
    const onRequest = vi.fn(() => new Promise<null>((resolve) => release.push(() => resolve(null))))
    const { written, say } = connect({ onRequest }, { maxIncomingRequests: 1 })

    say({ jsonrpc: '2.0', type: 'request', id: 'held', method: 'droid.ask_user', params: {} })
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1))
    say({ jsonrpc: '2.0', type: 'request', id: 'extra', method: 'droid.ask_user', params: {} })

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ id: 'extra', error: { code: -32603 } })
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

    const waitingEnded = once(waiting.fromDroid, 'end')
    closing.fromDroid.end()
    waiting.fromDroid.end()

    await vi.waitFor(() => expect(closing.peer.closed).toBe(true))
    await waitingEnded
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
    const { peer, fromDroid } = connect({ onClose }, { maxLineBytes: 256 })
    const open = peer.request('droid.add_user_message', {})
    const rejected = expect(open).rejects.toThrow('over the size limit')

    fromDroid.write(`${JSON.stringify({ filler: 'x'.repeat(400) })}\n`)

    await rejected
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('the protocol Droid reports', () => {
  it('is unknown until a frame carries it, then the newest one a frame carried', async () => {
    const { peer, say } = connect()
    expect(peer.protocolVersion).toBeUndefined()

    say({ jsonrpc: '2.0', type: 'notification', factoryProtocolVersion: '1.275.0', method: 'm' })
    await vi.waitFor(() => expect(peer.protocolVersion).toBe('1.275.0'))
    say({ jsonrpc: '2.0', type: 'notification', method: 'm' })
    say({ jsonrpc: '2.0', type: 'notification', factoryProtocolVersion: 7, method: 'm' })
    say({ jsonrpc: '2.0', type: 'notification', factoryProtocolVersion: '2.0.0', method: 'm' })

    await vi.waitFor(() => expect(peer.protocolVersion).toBe('2.0.0'))
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
})

describe('a request to Droid', () => {
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

  it('tells the caller the id before the frame is written, so an echo that beats the reply can be matched', async () => {
    const { peer, written } = connect()
    const ids: { id: string; alreadyWritten: number }[] = []

    void peer.request(
      'droid.add_user_message',
      { text: 'hi' },
      { onId: (id) => ids.push({ id, alreadyWritten: written.length }) }
    )
    await vi.waitFor(() => expect(written).toHaveLength(1))

    expect(ids).toEqual([{ id: written[0].id, alreadyWritten: 0 }])
  })
})

// Recorded Droid framing requires this field order, not just equivalent JSON.
const STAMP = '"jsonrpc":"2.0","factoryApiVersion":"1.0.0","factoryProtocolVersion":"1.269.0"'

describe('the bytes Orca writes to Droid', () => {
  it('writes a request as the stamp, its type, then id, method and params', async () => {
    const { peer, lines } = connect()

    void peer.request('droid.add_user_message', { text: 'hi' })
    void peer.request('droid.interrupt_session', {})

    await vi.waitFor(() => expect(lines).toHaveLength(2))
    expect(lines).toEqual([
      `{${STAMP},"type":"request","id":"orca-1","method":"droid.add_user_message","params":{"text":"hi"}}`,
      `{${STAMP},"type":"request","id":"orca-2","method":"droid.interrupt_session","params":{}}`
    ])
  })

  it('writes a handler result as a response under the id Droid sent, null when it returns nothing', async () => {
    const results = [{ selectedOption: 'proceed_once' }, undefined]
    const { lines, say } = connect({ onRequest: () => results.shift() })

    say({ jsonrpc: '2.0', type: 'request', id: 'cli-1', method: 'droid.request_permission' })
    await vi.waitFor(() => expect(lines).toHaveLength(1))
    say({ jsonrpc: '2.0', type: 'request', id: 'cli-2', method: 'droid.request_permission' })
    await vi.waitFor(() => expect(lines).toHaveLength(2))

    expect(lines).toEqual([
      `{${STAMP},"type":"response","id":"cli-1","result":{"selectedOption":"proceed_once"}}`,
      `{${STAMP},"type":"response","id":"cli-2","result":null}`
    ])
  })

  it('writes a refusal as an error with only a code and a message', async () => {
    const failures = [
      new DroidRpcError(-32602, 'Bad params', { secret: 1 }),
      new Error('private path')
    ]
    const { lines, say } = connect({
      onRequest: (method) => {
        if (method === 'droid.unhandled') {
          throw new DroidRpcError(-32601, 'Method not found')
        }
        throw failures.shift()
      }
    })

    say({ jsonrpc: '2.0', type: 'request', id: 'a', method: 'droid.pick_options' })
    say({ jsonrpc: '2.0', type: 'request', id: 'b', method: 'droid.pick_options' })
    say({ jsonrpc: '2.0', type: 'request', id: 'c', method: 'droid.unhandled' })

    await vi.waitFor(() => expect(lines).toHaveLength(3))
    expect(lines).toEqual([
      `{${STAMP},"type":"response","id":"a","error":{"code":-32602,"message":"Bad params"}}`,
      `{${STAMP},"type":"response","id":"b","error":{"code":-32603,"message":"Internal error"}}`,
      `{${STAMP},"type":"response","id":"c","error":{"code":-32601,"message":"Method not found"}}`
    ])
  })

  it('answers every request when nothing handles requests', async () => {
    const { lines, say } = connect()

    say({ jsonrpc: '2.0', type: 'request', id: 'cli-1', method: 'droid.ask_user' })

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(lines[0]).toBe(
      `{${STAMP},"type":"response","id":"cli-1","error":{"code":-32601,"message":"Method not found"}}`
    )
  })
})

it('rejects a response that names neither a result nor an error', async () => {
  const { peer, say } = connect()
  const reply = peer.request('droid.list_models', {})
  say({ jsonrpc: '2.0', type: 'response', id: 'orca-1' })
  await expect(reply).rejects.toThrow('Droid sent an invalid response')
})
