// usage: KEY_FILE=... node s5-terminal-held.mjs <version>
// T1: a live terminal UI holds S (`droid --resume S`, nothing submitted) while another process forks it over stream-jsonrpc.
// T2: `droid --fork S` as a terminal UI from folder b, nothing submitted.
// The real key is for the terminal UI only; no prompt is typed, so no model call is made. The stream-jsonrpc side uses the made-up key.
import { spawn } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanEnv, droidBin, listSessions, makeMasker, sandbox, startDroid, sleep, summarize, waitFor, writeResult } from './lib.mjs'

const [version] = process.argv.slice(2)
const PTY = process.env.PTY_DRIVE ?? '/tmp/droid-47/pty_drive.py'
const sb = sandbox(`s5-${version}`)
const { mask, name } = makeMasker(sb)
const mid = (x) => name(x, 'm')
const out = { version, T1: {}, T2: {} }
const where = (cwd) => (cwd === sb.a ? 'a' : cwd === sb.b ? 'b' : 'other')
const settings = join(sb.out, 'tui-settings.json')
writeFileSync(settings, JSON.stringify({ model: 'gpt-6-luna', reasoningEffort: 'none' }))

const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask, cwd: sb.a })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
name(S, 'S')
await p0.request('droid.add_user_message', { text: 'FORK-PROBE-SEED' })
await waitFor(() => listSessions(sb).get(S)?.records.some((r) => r.type === 'agent_turn_outcome'))
await p0.close()
const sha = (id) => listSessions(sb).get(id)?.sha
const shape = (s) => s.records.map((r) => summarize(r, mid))

const tui = (tag, cwd, args, seconds, sends) => new Promise((resolve) => {
  const pty = join(sb.out, `${tag}.pty`)
  const argv = [PTY, pty, String(seconds), cwd, ...sends.flatMap(([ms, text]) => ['--send', `${ms}:${text}`]), '--', droidBin(version), '--settings', settings, ...args]
  const child = spawn('python3', argv, { env: cleanEnv(sb.home, 'real'), stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.on('exit', () => resolve({ pty, log: mask(log).trim() }))
})

// T1. The terminal UI resumes S at ~9 s (after the folder-trust Enter) and idles; fork from another process at ~24 s.
{
  const before = listSessions(sb)
  const holder = tui('t1-holder', sb.a, ['--resume', S], 44, [[9000, '\\r'], [40000, '\\x03'], [40800, '\\x03']])
  await sleep(24000)
  const shaBeforeFork = sha(S)
  const p = startDroid(sb, { tag: 't1-fork', version, mode: 'bad', mask, cwd: sb.a })
  await p.request('droid.load_session', { sessionId: S })
  const fork = await p.request('droid.fork_session', {})
  const F = fork.result?.newSessionId
  await sleep(1500)
  const shaAfterFork = sha(S)
  await p.close()
  const res = await holder
  const after = listSessions(sb)
  out.T1 = {
    forkError: fork.error ? mask(JSON.stringify(fork.error)) : null,
    originalBytesChangedByFork: shaBeforeFork !== shaAfterFork,
    originalBytesChangedByTerminalByEnd: sha(S) !== shaAfterFork,
    holderOutput: res.log,
    newFiles: [...after].filter(([id]) => !before.has(id)).map(([id, s]) => ({ id: name(id, id === F ? 'F' : 'X'), recordedCwd: where(s.records[0].cwd), parent: s.records[0].parent ? name(s.records[0].parent, 'S') : null, records: shape(s) })),
    originalAtEnd: shape(after.get(S))
  }
  copyFileSync(res.pty, join(sb.out, 't1-holder.pty.keep'))
}

// T2. `droid --fork S` as a terminal UI from folder b.
{
  const before = listSessions(sb)
  const shaBefore = sha(S)
  const res = await tui('t2-tui-fork', sb.b, ['--fork', S], 30, [[9000, '\\r'], [26000, '\\x03'], [26800, '\\x03']])
  const after = listSessions(sb)
  out.T2 = {
    output: res.log,
    originalChanged: sha(S) !== shaBefore,
    newFiles: [...after].filter(([id]) => !before.has(id)).map(([id, s]) => ({ id: name(id, 'T'), slugFolder: s.slug === after.get(S).slug ? 'same as S (a)' : 'different from S', recordedCwd: where(s.records[0].cwd), parent: s.records[0].parent ? name(s.records[0].parent, 'S') : null, forkedAtMessageId: s.records[0].forkedAtMessageId ? mid(s.records[0].forkedAtMessageId) : null, records: shape(s) }))
  }
}

console.log(`wrote ${writeResult(sb, `s5-${version}`, out, mask)}`)
