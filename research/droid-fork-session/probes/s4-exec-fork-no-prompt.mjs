// usage: node s4-exec-fork-no-prompt.mjs <version>
// `droid exec --fork S` with no prompt argument and the default text formats: what does it do while stdin is open,
// and when stdin closes with nothing written? Made-up key only; nothing is ever written to stdin.
import { listSessions, makeMasker, sandbox, startDroid, sleep, summarize, waitFor, writeResult } from './lib.mjs'

const [version] = process.argv.slice(2)
const sb = sandbox(`s4-${version}`)
const { mask, name } = makeMasker(sb)
const mid = (x) => name(x, 'm')
const out = { version, mode: 'bad', cases: [] }
const where = (cwd) => (cwd === sb.a ? 'a' : cwd === sb.b ? 'b' : 'other')

const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask, cwd: sb.a })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
name(S, 'S')
await p0.request('droid.add_user_message', { text: 'FORK-PROBE-SEED' })
await waitFor(() => listSessions(sb).get(S)?.records.some((r) => r.type === 'agent_turn_outcome'))
await p0.close()
const sShaBefore = listSessions(sb).get(S).sha

const cases = [
  { id: 'c1', desc: 'stdin stays open 8 s, then closes empty', args: ['exec', '--fork', S], cwd: sb.a, hold: 8000 },
  { id: 'c2', desc: 'stdin closed at once (what a spawn with stdin ignored does)', args: ['exec', '--fork', S], cwd: sb.a, hold: 0 },
  { id: 'c3', desc: '--cwd b, stdin open 8 s, then closes empty', args: ['exec', '--fork', S, '--cwd', sb.b], cwd: sb.a, hold: 8000 }
]

for (const c of cases) {
  const before = listSessions(sb)
  const p = startDroid(sb, { tag: c.id, version, mode: 'bad', mask, cwd: c.cwd, args: c.args })
  const row = { id: c.id, desc: c.desc, argv: mask(['droid', ...c.args].join(' ')) }
  if (c.hold) {
    await sleep(c.hold)
    row.whileStdinOpen = {
      exited: Boolean(p.isExited()),
      stdoutBytes: p.frames.length,
      stderr: mask(p.stderr.join('')).slice(0, 300),
      newFiles: [...listSessions(sb)].filter(([id]) => !before.has(id)).length
    }
  }
  p.child.stdin.end()
  const res = await Promise.race([p.exited, sleep(30000).then(() => null)])
  if (!res) await p.close()
  row.afterStdinClosedEmpty = { exitCode: res ? res.code : 'still running after 30 s', stderr: mask(p.stderr.join('')).slice(0, 400) }
  row.newFiles = [...listSessions(sb)].filter(([id]) => !before.has(id)).map(([id, s]) => ({
    id: name(id, 'F'),
    recordedCwd: where(s.records[0].cwd),
    parent: s.records[0].parent ? name(s.records[0].parent, 'S') : null,
    records: s.records.map((r) => summarize(r, mid))
  }))
  row.originalChanged = listSessions(sb).get(S).sha !== sShaBefore
  out.cases.push(row)
}

const path = writeResult(sb, `s4-${version}`, out, mask)
console.log(`wrote ${path}`)
