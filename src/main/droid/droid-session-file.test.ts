import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDroidSessionStart } from './droid-session-file'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-droid-session-file-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function fileWith(content: string): Promise<string> {
  const path = join(root, 'session.jsonl')
  await writeFile(path, content, 'utf8')
  return path
}

const row = (value: unknown) => `${JSON.stringify(value)}\n`

describe('readDroidSessionStart', () => {
  it('reads the id and folder of a session Droid has created but not spoken in', async () => {
    const path = await fileWith(
      row({
        type: 'session_start',
        id: 'abc-123',
        parent: 'def-456',
        cwd: '/work/app',
        title: 'New Session'
      })
    )

    expect(await readDroidSessionStart(path)).toEqual({ id: 'abc-123', cwd: '/work/app' })
  })

  it('leaves the folder out when the row has none', async () => {
    expect(
      await readDroidSessionStart(await fileWith(row({ type: 'session_start', id: 'abc-123' })))
    ).toEqual({ id: 'abc-123' })
  })

  it('skips blank lines before the row and reads nothing past it', async () => {
    const path = await fileWith(`\n  \n${row({ type: 'session_start', id: 'abc-123' })}not json\n`)

    expect(await readDroidSessionStart(path)).toEqual({ id: 'abc-123' })
  })

  it.each([
    ['a zero-byte file', ''],
    ['only blank lines', '\n\n'],
    ['a first row that is not session_start', row({ type: 'message', id: 'abc-123' })],
    [
      'a session_start that comes second',
      row({ type: 'system' }) + row({ type: 'session_start', id: 'abc-123' })
    ],
    ['a session_start without an id', row({ type: 'session_start' })],
    ['a session_start whose id is not text', row({ type: 'session_start', id: 7 })],
    ['a first row that is not JSON', 'session_start\n'],
    ['a first row that is not an object', row(['session_start'])]
  ])('reads nothing from %s', async (_name, content) => {
    expect(await readDroidSessionStart(await fileWith(content))).toBeNull()
  })

  it('reads nothing from a first row longer than the bound, without loading the file', async () => {
    const path = await fileWith(
      `{"type":"session_start","id":"abc-123","title":"${'x'.repeat(200_000)}"}\n`
    )

    expect(await readDroidSessionStart(path)).toBeNull()
  })

  it('reads nothing from a file that is not there', async () => {
    expect(await readDroidSessionStart(join(root, 'missing.jsonl'))).toBeNull()
  })
})
