import { describe, expect, it } from 'vitest'
import {
  decodeStructuredAgentSessionOptionValue,
  encodeStructuredAgentSessionOptionValue
} from './structured-agent-session-option-codec'

describe('structured agent session option codec', () => {
  it('encodes and decodes explicit Fast mode booleans', () => {
    expect(encodeStructuredAgentSessionOptionValue('fastMode', true)).toBe('true')
    expect(encodeStructuredAgentSessionOptionValue('fastMode', false)).toBe('false')
    expect(decodeStructuredAgentSessionOptionValue('fastMode', 'true')).toBe(true)
    expect(decodeStructuredAgentSessionOptionValue('fastMode', 'false')).toBe(false)
  })

  it('rejects string booleans on the UI side and non-canonical strings on the wire side', () => {
    expect(encodeStructuredAgentSessionOptionValue('fastMode', 'true')).toBeNull()
    expect(decodeStructuredAgentSessionOptionValue('fastMode', 'TRUE')).toBeNull()
    expect(decodeStructuredAgentSessionOptionValue('fastMode', '1')).toBeNull()
  })

  it('encodes the Spec toggle (planMode) as a boolean the way Fast mode is', () => {
    expect(encodeStructuredAgentSessionOptionValue('planMode', true)).toBe('true')
    expect(encodeStructuredAgentSessionOptionValue('planMode', false)).toBe('false')
    expect(encodeStructuredAgentSessionOptionValue('planMode', 'true')).toBeNull()
    expect(decodeStructuredAgentSessionOptionValue('planMode', 'true')).toBe(true)
    expect(decodeStructuredAgentSessionOptionValue('planMode', 'false')).toBe(false)
    expect(decodeStructuredAgentSessionOptionValue('planMode', 'spec')).toBeNull()
  })

  it('passes existing string options through unchanged', () => {
    expect(encodeStructuredAgentSessionOptionValue('model', 'gpt-example')).toBe('gpt-example')
    expect(decodeStructuredAgentSessionOptionValue('effort', 'high')).toBe('high')
  })
})
