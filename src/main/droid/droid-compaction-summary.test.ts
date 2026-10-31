import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDroidCompactionSummary } from './droid-compaction-summary'
import { prepareLegacyTranscriptImport } from '../native-chat/agent-session-journal/journal-legacy-import'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-droid-summary-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const SESSION = 'summary-session'
const compacted = (id: string, summaryText: unknown) =>
  `${JSON.stringify({ type: 'compaction_state', id, summaryText })}\n`

async function read(content?: string) {
  const folder = join(root, '.factory', 'sessions', 'workspace')
  await mkdir(folder, { recursive: true })
  if (content !== undefined) {
    await writeFile(join(folder, `${SESSION}.jsonl`), content)
  }
  return readDroidCompactionSummary(
    {
      command: 'droid',
      args: [],
      env: { HOME: root, USERPROFILE: root }
    },
    SESSION
  )
}

describe('execution-host Droid session files', () => {
  it('keeps an adopted summary between the exchanges it precedes and follows', async () => {
    const message = (id: string, text: string) =>
      `${JSON.stringify({
        type: 'message',
        id,
        message: { role: 'assistant', content: [{ type: 'text', text }] }
      })}\n`
    await read(
      message('before', 'ok') + compacted('summary', 'Remember ok.') + message('after', 'Still ok.')
    )
    const imported = await prepareLegacyTranscriptImport({
      agent: 'droid',
      sessionId: SESSION,
      options: { filePath: join(root, '.factory', 'sessions', 'workspace', `${SESSION}.jsonl`) }
    })
    expect(imported).toMatchObject({
      ok: true,
      items: [
        { body: { kind: 'message', blocks: [{ type: 'text', text: 'ok' }] } },
        { body: { kind: 'status', summaryText: 'Remember ok.' } },
        { body: { kind: 'message', blocks: [{ type: 'text', text: 'Still ok.' }] } }
      ]
    })
  })

  it('imports the summary boundary when a different compact id is opened on its execution host', async () => {
    await read(compacted('new-summary', 'Remember **ok**.'))
    const imported = await prepareLegacyTranscriptImport({
      agent: 'droid',
      sessionId: SESSION,
      options: { filePath: join(root, '.factory', 'sessions', 'workspace', `${SESSION}.jsonl`) }
    })
    expect(imported).toMatchObject({
      ok: true,
      items: [
        expect.objectContaining({
          body: expect.objectContaining({
            kind: 'status',
            textKey: 'components.native-chat.droidHost.compressDone',
            summaryText: 'Remember **ok**.'
          })
        })
      ]
    })
  })

  it('reads the most recent compaction prose from the child’s account home', async () => {
    expect(
      await read(compacted('old', 'Earlier text.') + compacted('new', 'Remember **ok**.'))
    ).toEqual({ id: 'new', text: 'Remember **ok**.' })
  })

  it.each([
    ['missing file', undefined],
    ['older Droid', '{"type":"session_start","id":"summary-session"}\n'],
    ['unknown shape', compacted('summary', { prose: 'ok' })],
    ['empty summary', compacted('summary', ' ')],
    ['malformed file', 'not json\n'],
    ['incomplete write', '{"type":"compaction_state","summaryText":"ok"'],
    ['latest summary unreadable', compacted('old', 'Old text.') + compacted('new', null)]
  ])('falls back without an error for %s', async (_name, content) => {
    expect(await read(content)).toBeNull()
  })
})
