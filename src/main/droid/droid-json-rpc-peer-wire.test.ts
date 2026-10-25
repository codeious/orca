import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DroidJsonRpcPeer, type DroidPeerHandlers } from './droid-json-rpc-peer'
import { DroidRpcError } from './droid-rpc-errors'

// Droid drops a frame whose stamp or field order it does not recognise, so the bytes are the contract.
const STAMP = '"jsonrpc":"2.0","factoryApiVersion":"1.0.0","factoryProtocolVersion":"1.269.0"'

function connect(handlers: DroidPeerHandlers = {}, options: { maxIncomingRequests?: number } = {}) {
  const fromDroid = new PassThrough()
  const toDroid = new PassThrough()
  const lines: string[] = []
  let pending = ''
  toDroid.setEncoding('utf8')
  toDroid.on('data', (chunk: string) => {
    pending += chunk
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      lines.push(pending.slice(0, end))
      pending = pending.slice(end + 1)
    }
  })
  const peer = new DroidJsonRpcPeer(fromDroid, toDroid, handlers, options)
  const say = (frame: unknown) => fromDroid.write(`${JSON.stringify(frame)}\n`)
  return { peer, lines, say }
}

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

  it('turns away a request past its limit with code -32000 and says why', async () => {
    const { lines, say } = connect(
      { onRequest: () => new Promise(() => undefined) },
      { maxIncomingRequests: 1 }
    )

    say({ jsonrpc: '2.0', type: 'request', id: 'held', method: 'droid.ask_user' })
    say({ jsonrpc: '2.0', type: 'request', id: 'extra', method: 'droid.ask_user' })

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(lines[0]).toBe(
      `{${STAMP},"type":"response","id":"extra","error":{"code":-32000,"message":"Too many open requests"}}`
    )
  })
})
