import { z } from 'zod'
import type { AcpPeerDialect } from './acp-peer-dialect'

const idSchema = z.union([z.string(), z.number(), z.null()])
const errorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional()
})
export const acpRpcEnvelopeSchema = z.looseObject({
  jsonrpc: z.literal('2.0'),
  id: idSchema.optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional()
})
export type AcpJsonRpcMessage = z.infer<typeof acpRpcEnvelopeSchema>
/** What the peer reads off any inbound frame, whichever dialect's envelope it came in. */
export type AcpInboundFrame = {
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export function settleAcpResponse(
  frame: AcpInboundFrame,
  pending: { resolve: (value: unknown) => void; reject: (error: Error) => void },
  diagnose: (message: string) => void,
  { label, errors }: Pick<AcpPeerDialect, 'label' | 'errors'>
): void {
  if ('error' in frame) {
    const parsed = errorSchema.safeParse(frame.error)
    if (!parsed.success) {
      diagnose(`Invalid ${label} error response`)
      pending.reject(errors.invalidResponse(`Invalid ${label} error response`, frame.error))
    } else {
      const error = parsed.data
      pending.reject(errors.remote(error.code, error.message, error.data))
    }
  } else {
    pending.resolve(frame.result)
  }
}
