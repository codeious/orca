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
      .optional(),
    event: z.string().optional(),
    label: z.string().optional()
  })
})

async function readRecordedFrames(name: string): Promise<z.infer<typeof recordedFrame>[]> {
  const text = await readFile(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8')
  return text
    .trim()
    .split('\n')
    .map((line) => recordedFrame.parse(JSON.parse(line)))
}

export type DroidExchange = {
  method: string
  notifications: { method: string; params: unknown }[]
  answer: { result: unknown } | { error: { code: number; message: string } }
}

/** The recording's requests by the id it gave them (`r1`, `r2`, ...). */
export async function readDroidExchanges(name: string): Promise<Map<string, DroidExchange>> {
  const exchanges = new Map<string, DroidExchange>()
  const open = new Map<string, Omit<DroidExchange, 'answer'>>()
  let asking: string | undefined
  for (const { dir, frame } of await readRecordedFrames(name)) {
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

/** What Droid sent while it worked a recorded turn: its notifications, and its asks of the user. */
export type DroidRecordedStep =
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'ask'; id: string; method: string; params: unknown }

/** The steps of the turn the recording labels `label`, in the order Droid sent them. */
export async function readDroidTurn(name: string, label: string): Promise<DroidRecordedStep[]> {
  const steps: DroidRecordedStep[] = []
  let inside = false
  for (const { dir, frame } of await readRecordedFrames(name)) {
    if (dir === 'mark' && frame.label === label) {
      inside = frame.event === 'turn_start'
    } else if (inside && dir === 'in' && frame.type === 'notification' && frame.method) {
      steps.push({ kind: 'notification', method: frame.method, params: frame.params })
    } else if (inside && dir === 'in' && frame.type === 'request' && frame.id && frame.method) {
      steps.push({ kind: 'ask', id: frame.id, method: frame.method, params: frame.params })
    }
  }
  return steps
}

/** Plays a turn up to Droid's first ask of the user. `answer` is what Droid hears back; `rest` is
 *  what it sent after asking, to play once the person has answered. */
export function playUntilAsk(
  connection: FakeConnection,
  steps: DroidRecordedStep[]
): { answer: Promise<unknown>; rest: DroidRecordedStep[] } {
  const asked = steps.findIndex((step) => step.kind === 'ask')
  const ask = steps[asked]
  if (ask?.kind !== 'ask') {
    throw new Error('The recorded turn never asks the user')
  }
  playSteps(connection, steps.slice(0, asked))
  const { onRequest } = connection.handlers
  if (!onRequest) {
    throw new Error('The session answers no request from Droid')
  }
  // The peer turns a handler that throws into an error answer, as this does.
  const answer = new Promise<unknown>((resolve) =>
    resolve(onRequest(ask.method, ask.params, { id: ask.id, signal: new AbortController().signal }))
  )
  return { answer, rest: steps.slice(asked + 1) }
}

export function playSteps(connection: FakeConnection, steps: DroidRecordedStep[]): void {
  for (const step of steps) {
    if (step.kind !== 'notification') {
      throw new Error('Play a turn that asks with playUntilAsk')
    }
    connection.handlers.onNotification?.(step.method, step.params)
  }
}
