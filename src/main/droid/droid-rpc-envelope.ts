import { z } from 'zod'

// Droid drops a frame that lacks these, and answers numeric ids with an error.
export const FACTORY_API_VERSION = '1.0.0'
export const FACTORY_PROTOCOL_VERSION = '1.269.0'

/** The stamp goes ahead of the frame's own fields, and the frame carries `type` and a string `id`. */
export function stampDroidFrame<TFrame extends object>(frame: TFrame) {
  return {
    jsonrpc: '2.0' as const,
    factoryApiVersion: FACTORY_API_VERSION,
    factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
    ...frame
  }
}

/** What Droid writes: told apart by which fields are present, not by its `type` label. */
export const droidInboundFrameSchema = z.looseObject({
  factoryProtocolVersion: z.unknown().optional(),
  id: z.string().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .looseObject({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional()
})
