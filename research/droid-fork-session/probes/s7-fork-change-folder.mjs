// usage: KEY_FILE=... node s7-fork-change-folder.mjs <version>
// Can a loaded fork be moved to another folder with droid.change_working_directory, and does that touch the original?
// Free: no prompt is sent. The signed-in key is used only for a terminal start in folder b that accepts the trust dialog and exits.
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanEnv, droidBin, listSessions, makeMasker, sandbox, startDroid, sleep, waitFor, writeResult } from './lib.mjs'

const [version] = process.argv.slice(2)
const PTY = process.env.PTY_DRIVE ?? '/tmp/droid-47/pty_drive.py'
const sb = sandbox(`s7-${version}`)
const { mask, name } = makeMasker(sb)
const out = { version }
const where = (cwd) => (cwd === sb.a ? 'a' : cwd === sb.b ? 'b' : cwd ?? null)
const err = (r) => (r.error ? mask(JSON.stringify(r.error)).slice(0, 260) : null)

const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask, cwd: sb.a })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
name(S, 'S')
await p0.request('droid.add_user_message', { text: 'FORK-PROBE-SEED' })
await waitFor(() => listSessions(sb).get(S)?.records.some((r) => r.type === 'agent_turn_outcome'))
await p0.close()

// Query a copy: the live database is in WAL mode and a read-only open of it can fail.
const indexRows = () => {
  const tmp = mkdtempSync(join(tmpdir(), 'idx-'))
  try {
    const dir = join(sb.home, '.factory/cache/session-index')
    for (const f of readdirSync(dir).filter((n) => n.startsWith('index.db'))) copyFileSync(join(dir, f), join(tmp, f))
    const rows = execFileSync('sqlite3', ['-separator', '|', join(tmp, 'index.db'), 'select session_id, cwd from sessions'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    return Object.fromEntries(rows.map((r) => { const [id, cwd] = r.split('|'); return [name(id, id === S ? 'S' : id === F ? 'F' : 'X'), where(cwd)] }))
  } catch (e) { return `unreadable: ${mask(String(e.message)).slice(0, 120)}` } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// Which JSON keys differ, line by line, between two copies of a transcript.
const fileLines = (id) => readFileSync(listSessions(sb).get(id).file, 'utf8').split('\n').filter(Boolean)
const diffKeys = (a, b) => a.map((line, i) => {
  if (line === b[i]) return null
  const x = JSON.parse(line), y = JSON.parse(b[i] ?? '{}')
  return { line: i, type: x.type, keys: [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])) }
}).filter(Boolean).concat(b.length > a.length ? [{ addedLines: b.length - a.length }] : [])

// 1. Fork, load the fork, try the change while b is not trusted (control).
const p1 = startDroid(sb, { tag: 'p1-untrusted', version, mode: 'bad', mask, cwd: sb.a })
await p1.request('droid.load_session', { sessionId: S })
const fork = await p1.request('droid.fork_session', {})
const F = fork.result?.newSessionId
name(F, 'F')
await p1.request('droid.load_session', { sessionId: F })
const untrusted = await p1.request('droid.change_working_directory', { workingDirectory: sb.b })
out.untrustedFolder = { error: err(untrusted), resultKeys: Object.keys(untrusted.result ?? {}) }
await p1.close()

// 2. Trust folder b the way a user does: a terminal started in b, Enter on the trust dialog, Ctrl-C twice. Nothing submitted.
await new Promise((resolve) => {
  const argv = [PTY, join(sb.out, 'trust-b.pty'), '22', sb.b, '--send', '9000:\\r', '--send', '16000:\\x03', '--send', '16800:\\x03', '--', droidBin(version)]
  spawn('python3', argv, { env: cleanEnv(sb.home, 'real'), stdio: 'ignore' }).on('exit', resolve)
})

// 3. Load the fork, change its folder, and see what moved.
const sShaBefore = listSessions(sb).get(S).sha
const fBefore = fileLines(F)
const p2 = startDroid(sb, { tag: 'p2-trusted', version, mode: 'bad', mask, cwd: sb.a })
await p2.request('droid.load_session', { sessionId: F })
await sleep(800)
const fAfterLoad = fileLines(F)
const changed = await p2.request('droid.change_working_directory', { workingDirectory: sb.b })
await sleep(1200)
const fAfterChange = fileLines(F)
out.afterTrust = {
  error: err(changed),
  resolvedPathIs: where(changed.result?.resolvedPath),
  forkTranscriptChangedByLoad: diffKeys(fBefore, fAfterLoad),
  forkTranscriptChangedByChange: diffKeys(fAfterLoad, fAfterChange),
  transcriptOfOriginalChanged: listSessions(sb).get(S).sha !== sShaBefore
}
await p2.close()
const m = listSessions(sb)
out.afterTrust.forkSessionStartCwd = where(m.get(F).records[0].cwd)
out.afterTrust.originalSessionStartCwd = where(m.get(S).records[0].cwd)
out.afterTrust.sessionIndexCwd = indexRows()

// 4. Fresh processes: which folder does each report?
for (const [label, id] of [['freshLoadOfFork', F], ['freshLoadOfOriginal', S]]) {
  const p = startDroid(sb, { tag: label, version, mode: 'bad', mask, cwd: sb.a })
  const r = await p.request('droid.load_session', { sessionId: id })
  out[label] = { error: err(r), reportedCwd: where(r.result?.cwd) }
  await p.close()
}

console.log(`wrote ${writeResult(sb, `s7-${version}`, out, mask)}`)
