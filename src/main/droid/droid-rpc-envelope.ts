import { z } from 'zod'

// Droid drops a frame that lacks these, and answers numeric ids with an error.
export const FACTORY_API_VERSION = '1.0.0'
export const FACTORY_PROTOCOL_VERSION = '1.269.0'

export type DroidOutgoingFrame =
  | { type: 'request'; id: string; method: string; params: unknown }
  | { type: 'response'; id: string; result: unknown }
  | { type: 'response'; id: string; error: { code: number; message: string } }

export function stampDroidFrame(frame: DroidOutgoingFrame) {
  return {
    jsonrpc: '2.0' as const,
    factoryApiVersion: FACTORY_API_VERSION,
    factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
    ...frame
  }
}

/** What Droid writes: told apart by which fields are present, not by its `type` label. */
export const droidInboundFrameSchema = z.looseObject({
  id: z.string().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .looseObject({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional()
})
