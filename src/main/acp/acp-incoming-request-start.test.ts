import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpJsonRpcPeer, type AcpPeerHandlers } from './acp-json-rpc-peer'
import { acpPeerDialect, type AcpPeerDialect } from './acp-peer-dialect'

const peers: AcpJsonRpcPeer[] = []
function connect(handlers: AcpPeerHandlers, dialect: AcpPeerDialect) {
  const fromAgent = new PassThrough()
  const toAgent = new PassThrough()
  const written: Record<string, unknown>[] = []
  toAgent.setEncoding('utf8')
  toAgent.on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter(Boolean)) {
      written.push(JSON.parse(line))
    }
  })
  peers.push(new AcpJsonRpcPeer(fromAgent, toAgent, handlers, {}, dialect))
  return { written, fromAgent }
}
afterEach(() => peers.splice(0).forEach((peer) => peer.close()))

const request = { jsonrpc: '2.0', id: 1, method: 'session/request_permission' }
const notification = { jsonrpc: '2.0', method: 'session/update' }
const oneChunk = (...frames: unknown[]) =>
  frames.map((frame) => `${JSON.stringify(frame)}\n`).join('')

describe('when an incoming request starts its handler', () => {
  it('waits until the chunk it arrived in has been read, by default', async () => {
    const seen: string[] = []
    const { fromAgent } = connect(
      {
        onRequest: () => {
          seen.push('request')
        },
        onNotification: () => {
          seen.push('notification')
        }
      },
      acpPeerDialect
    )

    fromAgent.write(oneChunk(request, notification))

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen).toEqual(['notification', 'request'])
  })

  it('is before the next line of the chunk when the dialect asks for it', async () => {
    const seen: string[] = []
    const { fromAgent } = connect(
      {
        onRequest: () => {
          seen.push('request')
        },
        onNotification: () => {
          seen.push('notification')
        }
      },
      { ...acpPeerDialect, startRequestsSynchronously: true }
    )

    fromAgent.write(oneChunk(request, notification))

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen).toEqual(['request', 'notification'])
  })

  it('still answers a handler that throws right away as an error', async () => {
    const { written, fromAgent } = connect(
      {
        onRequest: () => {
          throw new Error('refused')
        }
      },
      { ...acpPeerDialect, startRequestsSynchronously: true }
    )

    fromAgent.write(oneChunk(request))

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ id: 1, error: { code: -32603, message: 'refused' } })
  })
})
