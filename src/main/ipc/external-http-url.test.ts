import { describe, expect, it } from 'vitest'
import { parseExternalHttpUrl } from './external-http-url'

describe('parseExternalHttpUrl', () => {
  it.each(['https://example.com/a?b=1', 'http://localhost:3000/'])('accepts %s', (raw) => {
    expect(parseExternalHttpUrl(raw)?.toString()).toBe(new URL(raw).toString())
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'vscode://x', 'not a url', ''])(
    'refuses %s',
    (raw) => {
      expect(parseExternalHttpUrl(raw)).toBeNull()
    }
  )
})
