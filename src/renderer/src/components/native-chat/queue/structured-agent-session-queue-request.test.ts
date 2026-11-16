import { expect, it } from 'vitest'
import {
  structuredAgentSessionQueueRequest,
  type StructuredAgentSessionQueueDelivery
} from './structured-agent-session-queue-request'

const queue = (
  overrides: Partial<StructuredAgentSessionQueueDelivery> = {}
): StructuredAgentSessionQueueDelivery => ({
  capability: 'supported',
  followUpsQueue: false,
  isWorking: true,
  stopping: false,
  session: {},
  prompts: [],
  ...overrides
})

it('queues an after-reply send whatever the follow-up setting, only where the host holds cards', () => {
  expect(structuredAgentSessionQueueRequest(queue())).toBeUndefined()
  expect(structuredAgentSessionQueueRequest(queue(), undefined, true)).toBe('queue-if-active')
  expect(structuredAgentSessionQueueRequest(queue({ stopping: true }), true, true)).toBe(
    'queue-if-active'
  )
  expect(
    structuredAgentSessionQueueRequest(queue({ capability: 'unknown' }), undefined, true)
  ).toBeUndefined()
})
