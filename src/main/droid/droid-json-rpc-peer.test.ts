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
  return { peer, written, lines, say, fromDroid }
}

describe('what Droid sends on its own', () => {
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

describe('a request to Droid', () => {
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
