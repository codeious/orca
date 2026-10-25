import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SESSION_ID = /^[A-Za-z0-9_-]+$/
// The same two roots the vault scanner lists Droid sessions from.
const SESSION_ROOTS = ['sessions', 'projects'] as const

/**
 * Droid files a session as `<root>/<folder slug>/<id>.jsonl` under its account home. The id comes
 * from a client, so it is checked before it can name a path.
 */
export async function findDroidSessionFile(
  accountHomePath: string,
  sessionId: string
): Promise<string | null> {
  if (!SESSION_ID.test(sessionId)) {
    return null
  }
  for (const root of SESSION_ROOTS) {
    const rootPath = join(accountHomePath, root)
    const folders = await readdir(rootPath, { withFileTypes: true }).catch(() => [])
    for (const folder of folders) {
      if (!folder.isDirectory()) {
        continue
      }
      const candidate = join(rootPath, folder.name, `${sessionId}.jsonl`)
      if ((await stat(candidate).catch(() => null))?.isFile()) {
        return candidate
      }
    }
  }
  return null
}
