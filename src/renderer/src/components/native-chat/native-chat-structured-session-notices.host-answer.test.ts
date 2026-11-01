import { describe, expect, it } from 'vitest'
import { structuredSessionNotices } from './native-chat-structured-session-notices'

const base = {
  launch: { lifecycle: null, failure: null, retry: () => {} },
  agentLabel: 'Droid',
  sessionError: null
}

describe('the composer line in a structured chat’s notices', () => {
  it('is an information notice when the host answered a command', () => {
    const onDismiss = () => {}
    const notices = structuredSessionNotices({
      ...base,
      composerError: { text: 'the key list', kind: 'info', onDismiss }
    })
    expect(notices).toEqual([
      { key: 'composer-error', kind: 'info', text: 'the key list', onDismiss }
    ])
  })

  it('stays an error notice when the line carries no kind', () => {
    const onDismiss = () => {}
    const notices = structuredSessionNotices({
      ...base,
      composerError: { text: 'Your message was not sent.', errorText: 'ECONNREFUSED', onDismiss }
    })
    expect(notices).toEqual([
      {
        key: 'composer-error',
        kind: 'error',
        text: 'Your message was not sent.',
        errorText: 'ECONNREFUSED',
        onDismiss
      }
    ])
  })

  it('keeps a session error an error beside an information line', () => {
    const notices = structuredSessionNotices({
      ...base,
      sessionError: 'Orca couldn’t save your message.',
      composerError: { text: 'the key list', kind: 'info', onDismiss: () => {} }
    })
    expect(notices.map(({ key, kind }) => [key, kind])).toEqual([
      ['session', 'error'],
      ['composer-error', 'info']
    ])
  })
})
