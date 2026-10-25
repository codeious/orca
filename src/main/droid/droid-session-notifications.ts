import { z } from 'zod'

const messageSchema = z.looseObject({
  id: z.string(),
  role: z.string(),
  content: z
    .array(
      z.looseObject({
        type: z.string(),
        text: z.string().optional(),
        thinking: z.string().optional()
      })
    )
    .default([]),
  visibility: z.string().optional()
})
const textStream = { messageId: z.string(), blockIndex: z.number().int().nonnegative() }

const handledSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('droid_working_state_changed'), newState: z.string() }),
  z.looseObject({
    type: z.literal('create_message'),
    message: messageSchema,
    requestId: z.string().optional()
  }),
  z.looseObject({
    type: z.literal('assistant_text_delta'),
    ...textStream,
    textDelta: z.string()
  }),
  z.looseObject({ type: z.literal('assistant_text_complete'), ...textStream }),
  z.looseObject({ type: z.literal('thinking_text_delta'), ...textStream, textDelta: z.string() }),
  z.looseObject({ type: z.literal('thinking_text_complete'), ...textStream }),
  z.looseObject({
    type: z.literal('tool_call'),
    toolUse: z.looseObject({ id: z.string(), name: z.string(), input: z.unknown() })
  }),
  z.looseObject({
    type: z.literal('tool_result'),
    toolUseId: z.string(),
    content: z.unknown(),
    isError: z.boolean().optional()
  }),
  z.looseObject({
    type: z.literal('error'),
    message: z.string().optional(),
    error: z.looseObject({ name: z.string().optional(), message: z.string().optional() }).optional()
  }),
  z.looseObject({
    type: z.literal('agent_turn_completed'),
    reason: z.string(),
    turnId: z.string().optional()
  })
])
const HANDLED_TYPES = new Set<string>(handledSchema.options.map((arm) => arm.shape.type.value))

export type DroidNotification = z.infer<typeof handledSchema> | { type: 'other' }
export type DroidMessage = z.infer<typeof messageSchema>

const envelopeSchema = z.looseObject({ notification: z.looseObject({ type: z.string() }) })

/** The notification inside a `droid.session_notification`. A type Orca has no use for, or has never
 *  seen, reads as `other`; one it reads but cannot parse throws, since silence would lose the turn. */
export function parseDroidNotification(params: unknown): DroidNotification {
  const envelope = envelopeSchema.safeParse(params)
  if (!envelope.success) {
    throw new Error('Invalid Droid notification')
  }
  const { notification } = envelope.data
  if (!HANDLED_TYPES.has(notification.type)) {
    return { type: 'other' }
  }
  const parsed = handledSchema.safeParse(notification)
  if (!parsed.success) {
    throw new Error('Invalid Droid notification')
  }
  return parsed.data
}
