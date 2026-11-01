// A Droid session file is read into a journal with the same legacy import Claude and Codex use.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import { DROID_HANDLE_TRANSPORT } from '../../droid/droid-agent-definition'
import { importLegacyTranscriptIntoJournal } from './journal-legacy-import'
import { openAgentSessionJournal } from './journal-store-factory'
import { openTestJournalHostDatabase } from './journal-host-database-test-support'

const SESSION = '5d0f7c2e-3a41-4b8e-9c10-2f6a8e4b7d31'

let root: string

function message(
  id: string,
  body: Record<string, unknown>,
  timestamp = '2026-10-20T10:00:00.000Z'
): unknown {
  return { type: 'message', id, timestamp, message: body }
}

const LINES: unknown[] = [
  { type: 'session_start', id: SESSION, cwd: '/work/app', title: 'Fix the build' },
  message('hook-1', { role: 'user', visibility: 'user_only', content: [], hookEventName: 'Start' }),
  message('u1', { role: 'user', content: [{ type: 'text', text: 'fix the build' }] }),
  message('a1', {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'reasoning that stays out', signature: 's' },
      { type: 'text', text: 'Reading the config.' },
      { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/work/app/a.ts' } }
    ]
  }),
  message('t1', {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'export const a = 1' }]
  }),
  { type: 'todo_state', todos: [] },
  message('a2', { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] })
]

async function writeSession(lines: unknown[]): Promise<string> {
  const path = join(root, `${SESSION}.jsonl`)
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf-8')
  return path
}

function openJournal() {
  let clock = 1_000
  return openAgentSessionJournal({
    identity: {
      sessionId: 'chat-1',
      workspaceId: 'ws-1',
      hostId: 'host-1',
      agent: 'droid',
      providerHandle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: SESSION }
    },
    database: openTestJournalHostDatabase(root),
    now: () => (clock += 1),
    mintEpoch: () => `epoch-${clock}`
  })
}

function key(recordId: string): string {
  return agentJournalItemKey({ provider: 'legacy', agent: 'droid', sessionId: SESSION, recordId })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-droid-import-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('droid history import', () => {
  it('keys each conversation record by its Droid message id and skips the rest', async () => {
    const filePath = await writeSession(LINES)
    const journal = await openJournal()

    const result = await importLegacyTranscriptIntoJournal({
      journal,
      agent: 'droid',
      sessionId: SESSION,
      fence: 1,
      options: { filePath }
    })

    expect(result).toMatchObject({ ok: true, imported: 4, replaced: true })
    expect(journal.snapshot().items.map((entry) => entry.itemId)).toEqual([
      key('u1'),
      key('a1'),
      key('t1'),
      key('a2')
    ])
  })

  it('carries what was said and done, never the reasoning', async () => {
    const filePath = await writeSession(LINES)
    const journal = await openJournal()
    await importLegacyTranscriptIntoJournal({
      journal,
      agent: 'droid',
      sessionId: SESSION,
      fence: 1,
      options: { filePath }
    })

    const bodies = journal.snapshot().items.map((entry) => entry.body)
    expect(bodies[0]).toMatchObject({
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'fix the build' }]
    })
    expect(bodies[1]).toMatchObject({
      kind: 'message',
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Reading the config.' },
        { type: 'tool-call', name: 'Read', callId: 'call-1' }
      ]
    })
    expect(JSON.stringify(bodies)).not.toContain('reasoning that stays out')
  })

  it('leaves the epoch alone when the file holds no conversation', async () => {
    const filePath = await writeSession([LINES[0], LINES[1]])
    const journal = await openJournal()

    const result = await importLegacyTranscriptIntoJournal({
      journal,
      agent: 'droid',
      sessionId: SESSION,
      fence: 1,
      options: { filePath }
    })

    expect(result).toMatchObject({ ok: true, imported: 0, replaced: false })
  })
})
