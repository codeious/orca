import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpRpcError } from './acp-errors'
import { AcpJsonRpcPeer, type AcpPeerHandlers, type AcpPeerOptions } from './acp-json-rpc-peer'
import { acpPeerDialect, type AcpPeerDialect } from './acp-peer-dialect'

class ToyClosedError extends Error {}
class ToyTimeoutError extends Error {}
class ToyInvalidError extends Error {}
class ToyRemoteError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: unknown
  ) {
    super(message)
  }
}

const toy: AcpPeerDialect = {
  ...acpPeerDialect,
  label: 'Toy',
  requestId: (sequence) => `toy-${sequence}`,
  stamp: (message) => ({ stamped: true, ...message }),
  errors: {
    closed: (message) => new ToyClosedError(message),
    timeout: (method) => new ToyTimeoutError(method),
    remote: (code, message, data) => new ToyRemoteError(code, message, data),
    invalidResponse: (message) => new ToyInvalidError(message)
  }
}

const peers: AcpJsonRpcPeer[] = []
function connect(
  handlers: AcpPeerHandlers = {},
  options: AcpPeerOptions = {},
  dialect: AcpPeerDialect = toy
) {
  const fromAgent = new PassThrough()
  const toAgent = new PassThrough()
  const lines: string[] = []
  let partial = ''
  toAgent.setEncoding('utf8')
  toAgent.on('data', (chunk: string) => {
    partial += chunk
    for (let end = partial.indexOf('\n'); end >= 0; end = partial.indexOf('\n')) {
      lines.push(partial.slice(0, end))
      partial = partial.slice(end + 1)
    }
  })
  const peer = new AcpJsonRpcPeer(fromAgent, toAgent, handlers, options, dialect)
  peers.push(peer)
  const say = (frame: unknown) => fromAgent.write(`${JSON.stringify(frame)}\n`)
  return { peer, lines, say, fromAgent }
}
afterEach(() => peers.splice(0).forEach((peer) => peer.close()))

describe('a dialect of the ACP peer', () => {
  it('mints each request id and writes the frame as the dialect shapes it', async () => {
    const { peer, lines, say } = connect()

    const first = peer.request('one', { a: 1 })
    const second = peer.request('two', {})
    await vi.waitFor(() => expect(lines).toHaveLength(2))

    expect(lines).toEqual([
      '{"stamped":true,"jsonrpc":"2.0","id":"toy-1","method":"one","params":{"a":1}}',
      '{"stamped":true,"jsonrpc":"2.0","id":"toy-2","method":"two","params":{}}'
    ])
    say({ jsonrpc: '2.0', id: 1, result: 'numeric id settles nothing' })
    say({ jsonrpc: '2.0', id: 'toy-2', result: 'second' })
    say({ jsonrpc: '2.0', id: 'toy-1', result: 'first' })
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
  })

  it('shapes the answers it gives to the agent the same way', async () => {
    const { lines, say } = connect({ onRequest: () => 'ok' })

    say({ jsonrpc: '2.0', id: 'agent-1', method: 'ask', params: {} })

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(lines[0]).toBe('{"stamped":true,"jsonrpc":"2.0","id":"agent-1","result":"ok"}')
  })

  it('tells the caller the request id before the frame is written', async () => {
    const { peer, lines } = connect()
    const seen: { id: string | number; written: number }[] = []

    peer
      .request('m', {}, { onId: (id) => seen.push({ id, written: lines.length }) })
      .catch(() => undefined)
    await vi.waitFor(() => expect(lines).toHaveLength(1))

    expect(seen).toEqual([{ id: 'toy-1', written: 0 }])
  })

  it('reads inbound records through the dialect, and names itself in what it reports', async () => {
    const onDiagnostic = vi.fn()
    const { peer, lines, say } = connect(
      { onDiagnostic },
      {},
      {
        ...toy,
        read: (record) =>
          typeof record === 'object' && record !== null && 'plain' in record
            ? { id: 'toy-1', result: record.plain }
            : undefined
      }
    )
    const open = peer.request('m', {})
    await vi.waitFor(() => expect(lines).toHaveLength(1))

    say({ plain: 'no envelope needed' })

    await expect(open).resolves.toBe('no envelope needed')
    say({ jsonrpc: '2.0', id: 'toy-9', method: 7 })
    await vi.waitFor(() =>
      expect(onDiagnostic).toHaveBeenCalledWith('Ignored invalid Toy JSON-RPC envelope')
    )
  })

  it('rejects the open request an unreadable answer was for, instead of leaving it open', async () => {
    const { peer, lines, say } = connect({}, {}, { ...toy, read: () => undefined })
    const open = peer.request('m', {})
    await vi.waitFor(() => expect(lines).toHaveLength(1))

    say({ jsonrpc: '2.0', id: 'toy-1', result: 'unreadable to this dialect' })

    await expect(open).rejects.toBeInstanceOf(ToyInvalidError)
  })

  it('reports closes, timeouts and answers in the dialect vocabulary', async () => {
    const closing = connect()
    const closed = closing.peer.request('m', {})
    closing.peer.close()
    await expect(closed).rejects.toBeInstanceOf(ToyClosedError)
    await expect(closing.peer.request('late', {})).rejects.toBeInstanceOf(ToyClosedError)

    const timing = connect({}, { requestTimeoutMs: 10 })
    await expect(timing.peer.request('slow', {})).rejects.toMatchObject({ message: 'slow' })
    await expect(timing.peer.request('slow', {})).rejects.toBeInstanceOf(ToyTimeoutError)

    const answering = connect()
    const refused = answering.peer.request('m', {})
    await vi.waitFor(() => expect(answering.lines).toHaveLength(1))
    answering.say({
      jsonrpc: '2.0',
      id: 'toy-1',
      error: { code: -32602, message: 'No', data: { why: 'x' } }
    })
    await expect(refused).rejects.toMatchObject({
      constructor: ToyRemoteError,
      code: -32602,
      message: 'No',
      data: { why: 'x' }
    })

    const both = connect()
    const ambiguous = both.peer.request('m', {})
    await vi.waitFor(() => expect(both.lines).toHaveLength(1))
    both.say({ jsonrpc: '2.0', id: 'toy-1', result: 1, error: { code: 1, message: 'm' } })
    await expect(ambiguous).rejects.toBeInstanceOf(ToyInvalidError)
  })

  it('names itself when a limit is hit', async () => {
    const { peer } = connect({}, { maxPendingRequests: 1 })

    peer.request('first', {}).catch(() => undefined)

    await expect(peer.request('second', {})).rejects.toThrow(
      'Toy pending request capacity exceeded'
    )
  })

  it('answers a request past the open-request limit with the dialect refusal', async () => {
    const { lines, say } = connect(
      { onRequest: () => new Promise(() => undefined) },
      { maxIncomingRequests: 1 },
      { ...toy, overCapacity: () => new AcpRpcError(-32000, 'Busy') }
    )

    say({ jsonrpc: '2.0', id: 'held', method: 'ask', params: {} })
    say({ jsonrpc: '2.0', id: 'extra', method: 'ask', params: {} })

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(lines[0]).toBe(
      '{"stamped":true,"jsonrpc":"2.0","id":"extra","error":{"code":-32000,"message":"Busy"}}'
    )
  })

  it('hands a line over the size limit to the dialect, which decides what it costs', async () => {
    const onOversizedLine = vi.fn()
    const { fromAgent } = connect({}, { maxLineBytes: 64 }, { ...toy, onOversizedLine })

    fromAgent.write(`${JSON.stringify({ filler: 'x'.repeat(200) })}\n`)

    await vi.waitFor(() => expect(onOversizedLine).toHaveBeenCalledTimes(1))
    expect(onOversizedLine.mock.calls[0][0]).toMatchObject({ kind: 'line-too-long' })
    expect(onOversizedLine.mock.calls[0][1]).toEqual({
      rejectPending: expect.any(Function),
      refuse: expect.any(Function),
      close: expect.any(Function),
      diagnose: expect.any(Function)
    })
  })
})
