import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  closeProviderTimelineRigs,
  openProviderTimelineRig
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { createLegacyProviderTimelineIdentityScheme } from '../native-chat/agent-session-timeline/provider-timeline-identity'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session/journal/agent-session-journal-types'
import { catchUpDroidTranscript } from './droid-history-catch-up'

const sid = '019fd532-7c11-7a90-b6de-4e1a2c3d5f60'
const roots: string[] = []
afterEach(async () => {
  await closeProviderTimelineRigs()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})
const message = (id: string, text: string) => ({
  type: 'message',
  id,
  message: { role: 'assistant', content: [{ type: 'text', text }] }
})
async function setup(live = true) {
  const root = await mkdtemp(join(tmpdir(), 'droid-catch-up-'))
  roots.push(root)
  await mkdir(join(root, 'sessions', 'folder'), { recursive: true })
  const file = join(root, 'sessions', 'folder', `${sid}.jsonl`)
  const rig = await openProviderTimelineRig({ agent: 'droid' }, { agent: 'droid' })
  const identity = live
    ? createLegacyProviderTimelineIdentityScheme({
        agent: 'droid',
        sessionId: 'session-timeline'
      }).item({
        namespace: 'session-timeline',
        family: 'item',
        thread: null,
        key: { source: 'provider', value: 'message:gen-1:a1:0:assistant' }
      })
    : { provider: 'legacy' as const, agent: 'droid', sessionId: sid, recordId: 'a1' }
  await rig.journal.appendItem(
    identity,
    {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'held answer' }]
    },
    { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  const warn = vi.fn()
  return {
    rig,
    file,
    warn,
    write: (rows: unknown[]) =>
      writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`),
    catchUp: (assertCurrent?: () => void) =>
      catchUpDroidTranscript({
        sessionId: 'session-timeline',
        providerSessionId: sid,
        accountHomePath: root,
        sink: rig.eventSink,
        logger: { warn, error: vi.fn() },
        assertCurrent
      }),
    text: async () =>
      (await rig.rows()).flatMap(({ body }) =>
        body.kind === 'message'
          ? body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []))
          : []
      )
  }
}

it.each([true, false])(
  'imports only turns after a live=%s anchor without duplicating held messages',
  async (live) => {
    const h = await setup(live)
    await h.write([message('a1', 'held answer'), message('a2', 'terminal answer')])
    await h.catchUp()
    expect(await h.text()).toEqual(['held answer', 'terminal answer'])
    expect((await h.rig.rows()).filter((row) => row.body.kind === 'status')).toHaveLength(1)
    await h.catchUp()
    expect(await h.text()).toEqual(['held answer', 'terminal answer'])
  }
)

it('skips the import when a rewind or compaction removed the anchor', async () => {
  const h = await setup()
  await h.write([message('a2', 'different branch')])
  await h.catchUp()
  expect(await h.text()).toEqual(['held answer'])
  expect(h.warn).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ reason: 'anchor-not-in-transcript' })
  )
})

it('abandons catch-up if live progress starts first', async () => {
  const h = await setup()
  await h.write([message('a1', 'held answer'), message('a2', 'terminal answer')])
  let checks = 0
  await h.catchUp(() => {
    if (++checks > 4) {
      throw new Error('live progress')
    }
  })
  expect(await h.text()).toEqual(['held answer'])
})
