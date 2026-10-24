// usage: node s3-fork-folder.mjs <version> <bad|real>
// Which folder does a fork record when the process runs in a different folder than the session was recorded in?
// A. droid.fork_session from a process started in folder b, on a session recorded in folder a (both key modes: no prompt is sent).
// B. `droid exec --fork S [--cwd b] "<prompt>"` outside stream-jsonrpc. A prompt is sent, so this part runs only with the made-up key (the turn fails auth).
import { listSessions, makeMasker, sandbox, startDroid, sleep, summarize, waitFor, writeResult } from './lib.mjs'

const [version, mode = 'bad'] = process.argv.slice(2)
const sb = sandbox(`s3-${version}-${mode}`)
const { mask, name } = makeMasker(sb)
const mid = (x) => name(x, 'm')
const out = { version, mode, A: {}, B: [] }
const where = (cwd) => (cwd === sb.a ? 'a' : cwd === sb.b ? 'b' : 'other')
const outcomes = (id) => listSessions(sb).get(id)?.records.filter((r) => r.type === 'agent_turn_outcome').length ?? 0

// Seed S in folder a with TWO failed-auth turns, so forkedAtMessageId has something to choose between.
const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask, cwd: sb.a })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
name(S, 'S')
for (const [i, text] of ['FORK-PROBE-SEED-ONE', 'FORK-PROBE-SEED-TWO'].entries()) {
  await p0.request('droid.add_user_message', { text })
  await waitFor(() => outcomes(S) >= i + 1)
}
await p0.close()
const seeded = listSessions(sb).get(S)
out.seeded = { recordedCwd: where(seeded.records[0].cwd), slug: mask(seeded.slug), records: seeded.records.map((r) => summarize(r, mid)) }

const describeNew = (before) => [...listSessions(sb)].filter(([id]) => !before.has(id)).map(([id, s]) => {
  const st = s.records[0]
  return { id: name(id, 'F'), slug: mask(s.slug), slugFolder: s.slug === seeded.slug ? 'same as S (a)' : 'different from S', recordedCwd: where(st.cwd), parent: st.parent ? name(st.parent, 'S') : null, forkedAtMessageId: st.forkedAtMessageId ? mid(st.forkedAtMessageId) : null, records: s.records.map((r) => summarize(r, mid)) }
})

// A. fork_session from a process in b.
{
  const before = listSessions(sb)
  const p = startDroid(sb, { tag: 'a-fork-in-b', version, mode, mask, cwd: sb.b })
  const load = await p.request('droid.load_session', { sessionId: S })
  const fork = await p.request('droid.fork_session', {})
  const F = fork.result?.newSessionId
  await sleep(1500)
  out.A.loadReportedCwd = where(load.result?.cwd)
  out.A.forkError = fork.error ? mask(JSON.stringify(fork.error)) : null
  out.A.newFiles = describeNew(before)
  await p.close()
  // A new process in b opens the fork: which folder does it report?
  const p2 = startDroid(sb, { tag: 'a-open-fork-in-b', version, mode, mask, cwd: sb.b })
  const loadF = await p2.request('droid.load_session', { sessionId: F })
  out.A.openForkInBReportsCwd = where(loadF.result?.cwd)
  await p2.close()
  const p3 = startDroid(sb, { tag: 'a-open-fork-in-a', version, mode, mask, cwd: sb.a })
  const loadF2 = await p3.request('droid.load_session', { sessionId: F })
  out.A.openForkInAReportsCwd = where(loadF2.result?.cwd)
  await p3.close()
}

// B. exec --fork outside stream-jsonrpc. Made-up key only, because most of these send a prompt.
if (mode === 'bad') {
  const cases = [
    { id: 'b1', desc: 'process in b, no --cwd, prompt', cwd: sb.b, args: ['exec', '--fork', S, 'FORK-PROBE-EXEC'] },
    { id: 'b2', desc: 'process in a, --cwd b, prompt', cwd: sb.a, args: ['exec', '--fork', S, '--cwd', sb.b, 'FORK-PROBE-EXEC'] },
    { id: 'b3', desc: 'process in a, --cwd a, prompt', cwd: sb.a, args: ['exec', '--fork', S, '--cwd', sb.a, 'FORK-PROBE-EXEC'] },
    // A prompt-free `exec --fork` is s4's job: it reads stdin, so closing it here would feed the harness frame in as a prompt.
    { id: 'b4', desc: 'no prompt, --output-format stream-jsonrpc only', cwd: sb.a, args: ['exec', '--fork', S, '--output-format', 'stream-jsonrpc'] },
    { id: 'b5', desc: 'prompt, --output-format stream-jsonrpc only', cwd: sb.a, args: ['exec', '--fork', S, '--output-format', 'stream-jsonrpc', 'FORK-PROBE-EXEC'] },
    { id: 'b6', desc: 'prompt, --input-format stream-jsonrpc', cwd: sb.a, args: ['exec', '--fork', S, '--input-format', 'stream-jsonrpc', 'FORK-PROBE-EXEC'] },
    { id: 'b7', desc: 'prompt, --output-format stream-json', cwd: sb.a, args: ['exec', '--fork', S, '--output-format', 'stream-json', 'FORK-PROBE-EXEC'] }
  ]
  for (const c of cases) {
    const before = listSessions(sb)
    const p = startDroid(sb, { tag: c.id, version, mode: 'bad', mask, cwd: c.cwd, args: c.args })
    const res = await Promise.race([p.exited, sleep(40000).then(() => null)])
    if (!res) await p.close()
    out.B.push({ id: c.id, desc: c.desc, argv: mask(['droid', ...c.args].join(' ')), exitCode: res ? res.code : 'still running after 40 s', stderr: mask(p.stderr.join('')).slice(0, 300), newFiles: describeNew(before), originalChanged: listSessions(sb).get(S).sha !== seeded.sha })
    // The original must be untouched by any fork; reset the baseline so later cases compare against the same file.
    seeded.sha = listSessions(sb).get(S).sha
  }
}

const path = writeResult(sb, `s3-${version}-${mode}`, out, mask)
console.log(`wrote ${path}`)
