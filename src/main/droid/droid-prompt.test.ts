import { describe, expect, it } from 'vitest'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import { DROID_PROMPT_MAX_BYTES, prepareDroidPrompt } from './droid-prompt'

const user = (...blocks: AgentJournalMessageItem['blocks']): AgentJournalMessageItem => ({
  kind: 'message',
  role: 'user',
  blocks
})

describe('the text Droid is sent', () => {
  it('is the text blocks of the message, in order, one to a line', () => {
    expect(
      prepareDroidPrompt(user({ type: 'text', text: 'one' }, { type: 'text', text: 'two' }))
    ).toEqual({ ok: true, params: { text: 'one\ntwo' } })
  })

  it('skips empty text blocks', () => {
    expect(
      prepareDroidPrompt(user({ type: 'text', text: '' }, { type: 'text', text: 'only' }))
    ).toEqual({ ok: true, params: { text: 'only' } })
  })

  it('is refused for a message with no text', () => {
    expect(prepareDroidPrompt(user())).toMatchObject({
      ok: false,
      failure: { kind: 'emptyMessage' }
    })
    expect(prepareDroidPrompt(user({ type: 'text', text: '' }))).toMatchObject({ ok: false })
  })

  it('is refused for a message from anyone but the user', () => {
    expect(
      prepareDroidPrompt({ ...user({ type: 'text', text: 'hi' }), role: 'assistant' })
    ).toEqual(expect.objectContaining({ ok: false }))
  })

  it('is refused, rather than sent without its image, when the message carries one', () => {
    expect(
      prepareDroidPrompt(
        user({ type: 'text', text: 'look' }, { type: 'image-ref', path: '/tmp/a.png' })
      )
    ).toMatchObject({
      ok: false,
      failure: { kind: 'attachmentInvalid', attachment: { reason: 'unsupportedType' } }
    })
  })

  it('is refused when it would not fit the line Droid reads', () => {
    const fits = 'a'.repeat(DROID_PROMPT_MAX_BYTES)
    expect(prepareDroidPrompt(user({ type: 'text', text: fits })).ok).toBe(true)
    expect(prepareDroidPrompt(user({ type: 'text', text: `${fits}a` }))).toMatchObject({
      ok: false,
      failure: { kind: 'historyTooLarge' }
    })
  })
})
