import { describe, expect, it } from 'vitest'
import { structuredAgentRuntimeRegistration } from '../runtime/structured-agent-runtime-registrations'
import { DROID_CHAT_VERSION_FLOOR } from './droid-version-support'

describe('Droid runtime registration', () => {
  it('registers stream-jsonrpc, host version checks and provider-owned approvals', () => {
    const registration = structuredAgentRuntimeRegistration('droid')
    expect(registration?.definition).toMatchObject({
      agent: 'droid',
      handleTransport: 'droid-stream-jsonrpc',
      capabilities: { approvalEnforcement: 'provider', steering: 'inject' }
    })
    expect(registration?.launchCheck?.minimumVersions).toEqual([DROID_CHAT_VERSION_FLOOR])
    expect(registration?.createAdapter).toBeTypeOf('function')
    const rules = registration?.definition.restingOptions
    expect(rules?.fallbackModels()).toBeNull()
    expect(rules?.effortDefaultsToModel).toBe(false)
    expect(rules?.acceptsKey('planMode')).toBe(true)
    expect(rules?.acceptsKey('fastMode')).toBe(false)
  })
})
