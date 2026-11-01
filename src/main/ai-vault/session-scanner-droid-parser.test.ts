import { describe, expect, it } from 'vitest'
import { isAiVaultSessionResumableContent } from '../../shared/ai-vault-types'
import { parseDroidSessionContent } from './session-scanner-droid-parser'
import { jsonLines } from './session-scanner-test-fixtures'

const FILE = {
  path: '/home/u/.factory/sessions/-work-app/droid-session.jsonl',
  mtimeMs: 1780000003000,
  modifiedAt: '2026-05-01T10:00:03.000Z'
}

const sessionStart = {
  type: 'session_start',
  id: 'droid-session',
  title: 'New Session',
  cwd: '/work/app'
}

// The records a signed-out first prompt writes (Droid 0.238.0 and 0.249.0): visibility is a
// field of `message`, and the failure notice arrives as a user-role message.
const reminder = {
  type: 'message',
  message: {
    role: 'user',
    visibility: 'llm_only',
    content: [{ type: 'text', text: '<system-reminder>\nUnified tool catalog\n</system-reminder>' }]
  }
}
const typedPrompt = {
  type: 'message',
  message: { role: 'user', content: [{ type: 'text', text: 'rename the cache module' }] }
}
const loginFailure = {
  type: 'message',
  message: {
    role: 'user',
    visibility: 'user_only',
    content: [{ type: 'text', text: 'Authentication failed. Please log in using /login' }]
  }
}
const reply = {
  type: 'message',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Renamed it.' }] }
}

async function parse(...records: unknown[]) {
  const session = await parseDroidSessionContent(FILE, jsonLines(records), 'linux')
  if (!session) {
    throw new Error('the Droid transcript did not parse')
  }
  return session
}

describe('parseDroidSessionContent message counting', () => {
  it('counts only the conversation, not llm_only or user_only records', async () => {
    const session = await parse(sessionStart, reminder, typedPrompt, loginFailure, reply)

    expect(session.messageCount).toBe(2)
    expect(session.previewMessages.map((message) => message.role)).toEqual(['user', 'assistant'])
  })

  it('treats a transcript with only hidden records as empty', async () => {
    const session = await parse(sessionStart, reminder, loginFailure)

    expect(session.messageCount).toBe(0)
    expect(isAiVaultSessionResumableContent(session)).toBe(false)
  })

  it('does not count a completion line as a message', async () => {
    const session = await parse(sessionStart, {
      type: 'completion',
      finalText: 'Done.',
      usage: { input_tokens: 4, output_tokens: 6 }
    })

    expect(session.messageCount).toBe(0)
    expect(isAiVaultSessionResumableContent(session)).toBe(false)
  })
})
