import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session/journal/agent-session-journal-types'
import { runDroidRigCleanups, setupDroidAdapter } from './droid-adapter-rig.test-support'
import { droidProviderLink } from './droid-session-launch-contract'

const roots: string[] = []
afterEach(async () => {
  await runDroidRigCleanups()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

it('adds terminal answers after the last held message when the adapter resumes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'droid-history-'))
  roots.push(root)
  const id = '019fd532-7c11-7a90-b6de-4e1a2c3d5f60'
  const folder = join(root, '.factory', 'sessions', 'folder')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, `${id}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'held answer' }]
        }
      }),
      JSON.stringify({
        type: 'message',
        id: 'a2',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'terminal answer' }]
        }
      }),
      ''
    ].join('\n')
  )
  const h = await setupDroidAdapter(
    {
      env: { HOME: root, USERPROFILE: root },
      previous: droidProviderLink({ previous: null }, id, 1, 'original-link', 1)
    },
    undefined,
    { realpath: async (path) => path }
  )
  await h.rig.journal.appendItem(
    { provider: 'legacy', agent: 'droid', sessionId: id, recordId: 'a1' },
    { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'held answer' }] },
    { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  await h.start()
  expect(
    (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'message'
        ? body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []))
        : []
    )
  ).toEqual(['held answer', 'terminal answer'])
})
