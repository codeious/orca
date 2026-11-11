import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { asRecord } from '../ai-vault/session-scanner-record-value'
import { isDroidSessionId } from './droid-session-id'
import type { DroidCompactionSummary } from './droid-compaction-summary'

// The same two roots the vault scanner lists Droid sessions from.
const SESSION_ROOTS = ['sessions', 'projects'] as const

// A `session_start` row is a few hundred bytes; a longer first row is not one worth trusting.
const SESSION_START_MAX_BYTES = 64 * 1024
const COMPACTION_TAIL_MAX_BYTES = 1024 * 1024

/**
 * Droid files a session as `<root>/<folder slug>/<id>.jsonl` under its account home. The id comes
 * from a client, so it is checked before it can name a path.
 */
export async function findDroidSessionFile(
  accountHomePath: string,
  sessionId: string
): Promise<string | null> {
  if (!isDroidSessionId(sessionId)) {
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

/**
 * The `session_start` row that opens a Droid session file. Droid writes only this row for a
 * session it has created but nobody has spoken in yet, so it is all there is to identify one.
 */
export async function readDroidSessionStart(
  filePath: string
): Promise<{ id: string; cwd?: string } | null> {
  const row = await readFirstRow(filePath)
  if (!row || row.type !== 'session_start' || typeof row.id !== 'string') {
    return null
  }
  return { id: row.id, ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}) }
}

/** A bounded tail excludes old tool output and summaries. */
export async function readDroidSessionCompaction(
  filePath: string
): Promise<DroidCompactionSummary | null> {
  const handle = await open(filePath, 'r').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const size = (await handle.stat()).size
    const start = Math.max(0, size - COMPACTION_TAIL_MAX_BYTES)
    const buffer = Buffer.alloc(Math.min(size, COMPACTION_TAIL_MAX_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8', 0, bytesRead)
    const complete = text.slice(start ? text.indexOf('\n') + 1 : 0, text.lastIndexOf('\n') + 1)
    for (const line of complete.split('\n').toReversed()) {
      let row: Record<string, unknown> | null
      try {
        row = asRecord(JSON.parse(line))
      } catch {
        continue
      }
      if (row?.type !== 'compaction_state') {
        continue
      }
      return typeof row.id === 'string' &&
        typeof row.summaryText === 'string' &&
        row.summaryText.trim()
        ? { id: row.id, text: row.summaryText }
        : null
    }
    return null
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

async function readFirstRow(filePath: string): Promise<Record<string, unknown> | null> {
  const handle = await open(filePath, 'r').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const buffer = Buffer.alloc(SESSION_START_MAX_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.toString('utf8', 0, bytesRead)
    // A read that filled the buffer ends mid-row, so only the rows before its last newline count.
    const rows = bytesRead < buffer.length ? text : text.slice(0, text.lastIndexOf('\n') + 1)
    const line = rows.split('\n').find((candidate) => candidate.trim() !== '')
    return line === undefined ? null : asRecord(JSON.parse(line))
  } catch {
    return null
  } finally {
    await handle.close()
  }
}
