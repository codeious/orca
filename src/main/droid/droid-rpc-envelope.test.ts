import {
  AddUserMessageRequestSchema,
  AskUserResponseSchema,
  CliRequestOrNotificationSchema,
  FACTORY_PROTOCOL_VERSION as SDK_PROTOCOL_VERSION,
  InterruptSessionRequestSchema,
  LEGACY_FACTORY_API_VERSION as SDK_API_VERSION,
  PickOptionsResponseSchema,
  RequestPermissionResponseSchema
} from '@factory/droid-sdk'
import { describe, expect, it } from 'vitest'
import {
  droidInboundFrameSchema,
  FACTORY_API_VERSION,
  FACTORY_PROTOCOL_VERSION,
  stampDroidFrame
} from './droid-rpc-envelope'

// The SDK is a dev dependency only: it tells these tests what Droid's wire is, never ships.
describe('the frames Orca writes, against the SDK that defines them', () => {
  it('stamps the versions the SDK declares', () => {
    expect(FACTORY_API_VERSION).toBe(SDK_API_VERSION)
    expect(FACTORY_PROTOCOL_VERSION).toBe(SDK_PROTOCOL_VERSION)
  })

  it.each([
    ['droid.add_user_message', AddUserMessageRequestSchema, { text: 'hi' }],
    ['droid.interrupt_session', InterruptSessionRequestSchema, {}]
  ])('writes a %s request the SDK accepts', (method, schema, params) => {
    const frame = stampDroidFrame({ type: 'request', id: 'orca-1', method, params })

    expect(schema.safeParse(frame).success).toBe(true)
  })

  it('has a SDK check that can fail: a numeric id, which Droid refuses, is not accepted', () => {
    const frame = {
      ...stampDroidFrame({
        type: 'request',
        id: 'orca-1',
        method: 'droid.add_user_message',
        params: { text: 'hi' }
      }),
      id: 1
    }

    expect(AddUserMessageRequestSchema.safeParse(frame).success).toBe(false)
  })

  it.each([
    ['droid.request_permission', RequestPermissionResponseSchema],
    ['droid.ask_user', AskUserResponseSchema],
    ['droid.pick_options', PickOptionsResponseSchema]
  ])('answers a %s request with an error the SDK accepts', (_method, schema) => {
    const frame = stampDroidFrame({
      type: 'response',
      id: 'cli-1',
      error: { code: -32601, message: 'Method not found' }
    })

    expect(schema.safeParse(frame).success).toBe(true)
  })
})

describe('the frames Droid writes, read by both', () => {
  const notification = {
    jsonrpc: '2.0',
    type: 'notification',
    factoryApiVersion: '1.0.0',
    factoryProtocolVersion: '1.275.0',
    method: 'droid.session_notification',
    params: {
      sessionId: 'session-1',
      notification: { type: 'droid_working_state_changed', newState: 'idle' }
    }
  }

  it('reads a session notification as a notification, as the SDK does', () => {
    expect(CliRequestOrNotificationSchema.safeParse(notification).success).toBe(true)
    expect(droidInboundFrameSchema.parse(notification)).toMatchObject({
      method: 'droid.session_notification',
      params: notification.params
    })
    expect(droidInboundFrameSchema.parse(notification).id).toBeUndefined()
  })
})
