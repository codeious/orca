import { describe, expect, it } from 'vitest'
import { decodeDroidTranscriptLine } from './transcript-line-decoders-droid'

function record(message: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'message',
    id: 'm-1',
    timestamp: '2026-10-20T10:00:00.000Z',
    message,
    ...extra
  })
}

describe('decodeDroidTranscriptLine', () => {
  it('decodes a typed prompt as a user message that keeps Droid message id and time', () => {
    const decoded = decodeDroidTranscriptLine(
      record({ role: 'user', content: [{ type: 'text', text: 'fix the build' }] }),
      'fallback'
    )
    expect(decoded).toEqual({
      id: 'm-1',
      role: 'user',
      blocks: [{ type: 'text', text: 'fix the build' }],
      timestamp: Date.parse('2026-10-20T10:00:00.000Z'),
      source: 'transcript'
    })
  })

  it('keeps the answer and the tool call but not the reasoning beside them', () => {
    const decoded = decodeDroidTranscriptLine(
      record({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private chain of thought', signature: 'sig' },
          { type: 'text', text: 'Looking at it.' },
          { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/a' } }
        ]
      }),
      'fallback'
    )
    expect(decoded?.role).toBe('assistant')
    expect(decoded?.blocks).toEqual([
      { type: 'text', text: 'Looking at it.' },
      { type: 'tool-call', name: 'Read', input: { file_path: '/a' }, callId: 'call-1' }
    ])
  })

  it('drops an assistant message that holds only reasoning', () => {
    expect(
      decodeDroidTranscriptLine(
        record({ role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] }),
        'fallback'
      )
    ).toBeNull()
  })

  it('reads a user record that only carries tool results as a tool message', () => {
    const decoded = decodeDroidTranscriptLine(
      record({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'file text' }]
      }),
      'fallback'
    )
    expect(decoded?.role).toBe('tool')
    expect(decoded?.blocks).toEqual([expect.objectContaining({ type: 'tool-result' })])
  })

  it.each(['llm_only', 'user_only'])(
    'skips a %s record, which is a reminder or notice and not conversation',
    (visibility) => {
      expect(
        decodeDroidTranscriptLine(
          record({ role: 'user', visibility, content: [{ type: 'text', text: 'reminder' }] }),
          'fallback'
        )
      ).toBeNull()
    }
  )

  it.each([
    ['a session start', JSON.stringify({ type: 'session_start', id: 's', cwd: '/w' })],
    ['a todo snapshot', JSON.stringify({ type: 'todo_state', todos: [] })],
    ['a turn outcome', JSON.stringify({ type: 'agent_turn_outcome', id: 'o' })],
    ['a system role', record({ role: 'system', content: [{ type: 'text', text: 'x' }] })],
    ['a line that is not JSON', '{not json']
  ])('skips %s', (_name, line) => {
    expect(decodeDroidTranscriptLine(line, 'fallback')).toBeNull()
  })

  it('falls back to the line position when the record names no id', () => {
    const line = JSON.stringify({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }
    })
    expect(decodeDroidTranscriptLine(line, 'line-7')?.id).toBe('line-7')
  })
})
