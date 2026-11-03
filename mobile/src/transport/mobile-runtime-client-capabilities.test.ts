import { describe, expect, it } from 'vitest'
import { parseRuntimeClientCapabilities } from '../../../src/main/runtime/rpc/runtime-client-capabilities'
import {
  MOBILE_RUNTIME_CLIENT_CAPABILITIES,
  mobileRuntimeClientCapabilityUpdateRequest
} from './mobile-runtime-client-capabilities'

describe('mobile runtime client capabilities', () => {
  it('advertises session-scoped options so hosts include Droid permissions', () => {
    const request = mobileRuntimeClientCapabilityUpdateRequest({
      id: 'capabilities',
      deviceToken: 'phone'
    })
    expect(request.params.clientCapabilities).toContain('agent-session.session-options.v1')
  })

  it('stays inside the bounds the host parses, which fail closed to no capabilities at all', () => {
    expect(parseRuntimeClientCapabilities(MOBILE_RUNTIME_CLIENT_CAPABILITIES)).toEqual(
      MOBILE_RUNTIME_CLIENT_CAPABILITIES
    )
  })
})
