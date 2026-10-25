// Plays a recorded Droid exchange back through the fake connection: the notifications Droid
// sent while the request was open, then its answer. The recording's request id is rewritten to
// the one this run sent, as the real Droid echoes the id it was given.

import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { FakeConnection, Reply } from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'

const recordedFrame = z.object({
  dir: z.enum(['in', 'out', 'mark']),
  frame: z.looseObject({
    type: z.string().optional(),
    id: z.string().optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
      .optional()
  })
})

export type DroidExchange = {
  method: string
  notifications: { method: string; params: unknown }[]
  answer: { result: unknown } | { error: { code: number; message: string } }
}

/** The recording's requests by the id it gave them (`r1`, `r2`, ...). */
export async function readDroidExchanges(name: string): Promise<Map<string, DroidExchange>> {
  const text = await readFile(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8')
  const exchanges = new Map<string, DroidExchange>()
  const open = new Map<string, Omit<DroidExchange, 'answer'>>()
  let asking: string | undefined
  for (const line of text.trim().split('\n')) {
    const { dir, frame } = recordedFrame.parse(JSON.parse(line))
    if (dir === 'out' && frame.type === 'request' && frame.id && frame.method) {
      open.set(frame.id, { method: frame.method, notifications: [] })
      asking = frame.id
    } else if (dir === 'in' && frame.type === 'notification' && frame.method && asking) {
      open.get(asking)?.notifications.push({ method: frame.method, params: frame.params })
    } else if (dir === 'in' && frame.type === 'response' && frame.id) {
      const request = open.get(frame.id)
      if (request) {
        exchanges.set(frame.id, {
          ...request,
          answer: frame.error ? { error: frame.error } : { result: frame.result }
        })
        open.delete(frame.id)
      }
    }
  }
  return exchanges
}

/** The reply a fake connection gives its request: the recorded notifications, then the answer. */
export function replayExchange(
  connection: FakeConnection,
  exchanges: Map<string, DroidExchange>,
  recordedId: string
): Reply {
  const exchange = exchanges.get(recordedId)
  if (!exchange) {
    throw new Error(`The recording has no request ${recordedId}`)
  }
  return () => {
    for (const { method, params } of exchange.notifications) {
      const sent = JSON.stringify(params).replaceAll(
        `"requestId":${JSON.stringify(recordedId)}`,
        `"requestId":${JSON.stringify(connection.lastId)}`
      )
      connection.handlers.onNotification?.(method, JSON.parse(sent))
    }
    if ('error' in exchange.answer) {
      const { code, message } = exchange.answer.error
      throw new DroidRpcError(code, message)
    }
    return exchange.answer.result
  }
}
