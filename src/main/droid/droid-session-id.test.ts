import { describe, expect, it } from 'vitest'
import { isDroidSessionId } from './droid-session-id'

describe('isDroidSessionId', () => {
  it.each(['a1b2c3', 'session_abc-123', '019fd532-7c11-7a90-b6de-4e1a2c3d5f60'])(
    'accepts the bare token %s',
    (id) => {
      expect(isDroidSessionId(id)).toBe(true)
    }
  )

  it.each(['', '../x', 'a/b', 'a\\b', 'a b', 'https://app.factory.ai/s/1', 'id\n', 'ünï'])(
    'rejects %j, which is a path, a link or free text',
    (value) => {
      expect(isDroidSessionId(value)).toBe(false)
    }
  )
})
