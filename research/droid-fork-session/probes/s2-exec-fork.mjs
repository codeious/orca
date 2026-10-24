// usage: node s2-exec-fork.mjs <version> <bad|real>
// Does `droid exec --fork <S> [--cwd <dir>]` work over stream-jsonrpc with no prompt, and which folder does the fork record?
// No prompt is ever sent. Key mode "real" cannot spend credits: initialize_session and rename_session call no model.
import { listSessions, makeMasker, sandbox, startDroid, sleep, summarize, waitFor, writeResult } from './lib.mjs'

const [version, mode = 'bad'] = process.argv.slice(2)
const sb = sandbox(`s2-${version}-${mode}`)
const { mask, name } = makeMasker(sb)
const mid = (x) => name(x, 'm')
const out = { version, mode, variants: [] }

// Seed S in folder a with one failed-auth turn (made-up key always).
const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask, cwd: sb.a })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
name(S, 'S')
await p0.request('droid.add_user_message', { text: 'FORK-PROBE-SEED' })
await waitFor(() => listSessions(sb).get(S)?.records.some((r) => r.type === 'agent_turn_outcome'))
await p0.close()

const folderOf = (p) => (p === sb.a ? 'a (the recorded folder)' : p === sb.b ? 'b (a different folder)' : p === sb.missing ? 'a path that does not exist' : p)
const variants = [
  { id: 'v1', desc: 'process in a, no --cwd', cwd: sb.a, flag: null, workspace: sb.a },
  { id: 'v2', desc: 'process in b, --cwd b', cwd: sb.b, flag: sb.b, workspace: sb.b },
  { id: 'v3', desc: 'process in b, no --cwd', cwd: sb.b, flag: null, workspace: sb.b },
  { id: 'v4', desc: 'process in a, --cwd b', cwd: sb.a, flag: sb.b, workspace: sb.b },
  { id: 'v5', desc: 'process in a, --cwd that does not exist', cwd: sb.a, flag: sb.missing, workspace: sb.missing }
]

for (const v of variants) {
  const before = listSessions(sb)
  const args = ['exec', '--fork', S, ...(v.flag ? ['--cwd', v.flag] : []), '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc']
  const notes = []
  const p = startDroid(sb, { tag: `${v.id}`, version, mode, mask, cwd: v.cwd, args, onNotification: (n) => notes.push(n.type) })
  const row = { variant: v.id, desc: v.desc, argv: mask(['droid', ...args].join(' ')) }

  // 1. Say nothing: does it exit, error, or wait?
  const early = await Promise.race([p.exited, sleep(6000).then(() => null)])
  row.afterSixSecondsOfSilence = early ? { exited: true, code: early.code, signal: early.signal, atMs: early.atMs } : { exited: false }
  row.stdoutFrames = p.frames.map((f) => [f.kind, f.method, f.notification].filter(Boolean).join(':'))
  row.stderr = mask(p.stderr.join('')).slice(0, 400)
  row.newFilesBeforeAnyRequest = Object.keys(Object.fromEntries([...listSessions(sb)].filter(([id]) => !before.has(id)))).map((id) => name(id, 'id'))

  // 2. If it is waiting, open a session the way a client would: initialize_session with the workspace.
  if (!early) {
    const init2 = await p.request('droid.initialize_session', { machineId: 'probe-machine', cwd: v.workspace, interactionMode: 'auto', autonomyLevel: 'off' })
    const sid = init2.result?.sessionId
    row.initializeSession = {
      error: init2.error ? mask(JSON.stringify(init2.error)).slice(0, 300) : null,
      resultKeys: Object.keys(init2.result ?? {}),
      sessionIdIs: sid === S ? 'S (the original)' : sid ? `a new id ${name(sid, 'F')}` : null
    }
    await sleep(1500)
    if (sid) {
      const rename = await p.request('droid.rename_session', { title: `FORK-PROBE-${v.id}` })
      await sleep(1200)
      const after = listSessions(sb)
      row.renameLandedIn = [...after].filter(([id, s]) => s.records[0]?.title === `FORK-PROBE-${v.id}`).map(([id]) => name(id, 'id'))
      row.renameError = rename.error ? mask(JSON.stringify(rename.error)).slice(0, 200) : null
    }
    row.notifications = notes
    const exit = await p.close()
    row.exitAfterClose = { code: exit.code, signal: exit.signal }
  }

  const after = listSessions(sb)
  row.newFiles = [...after].filter(([id]) => !before.has(id)).map(([id, s]) => {
    const start = s.records[0]
    const sMsgs = after.get(S).records.filter((r) => r.type === 'message').map((r) => r.id)
    const msgs = s.records.filter((r) => r.type === 'message').map((r) => r.id)
    return {
      id: name(id, 'F'),
      slug: mask(s.slug),
      recordedCwd: mask(String(start.cwd)),
      cwdIs: start.cwd === sb.a ? 'a' : start.cwd === sb.b ? 'b' : 'other',
      parent: start.parent ? name(start.parent, 'S') : null,
      forkedAtMessageId: start.forkedAtMessageId ? mid(start.forkedAtMessageId) : null,
      records: s.records.map((r) => summarize(r, mid)),
      copiesSMessageIds: JSON.stringify(msgs.slice(0, sMsgs.length)) === JSON.stringify(sMsgs)
    }
  })
  row.originalChanged = after.get(S).sha !== before.get(S).sha || after.get(S).settingsSha !== before.get(S).settingsSha
  out.variants.push(row)
  if (!p.isExited()) await p.close()
}

const path = writeResult(sb, `s2-${version}-${mode}`, out, mask)
console.log(`wrote ${path}`)
console.log(mask(JSON.stringify(out, null, 1)))
