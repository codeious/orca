// usage: node s1-fork-in-process.mjs <version> <bad|real>
// Seeds session S (one failed-auth turn, so it has history), then in a second process: load S, droid.fork_session,
// then write (a rename, plus a failed-auth message when the key is the made-up one) and see which file takes the write.
// Key mode "real" sends no prompt at all, so it cannot spend credits.
import { listSessions, makeMasker, sandbox, startDroid, summarize, waitFor, writeResult } from './lib.mjs'

const [version, mode = 'bad'] = process.argv.slice(2)
const sb = sandbox(`s1-${version}-${mode}`)
const { mask, name } = makeMasker(sb)
const mid = (x) => name(x, 'm')
const out = { version, mode, steps: [] }
const step = (label, data) => out.steps.push({ label, ...data })
const outcomes = (snap, id) => snap.get(id)?.records.filter((r) => r.type === 'agent_turn_outcome').length ?? 0

function view(snap, id) {
  const s = snap.get(id)
  if (!s) return null
  const start = s.records[0]
  return {
    slug: mask(s.slug),
    records: s.records.map((r) => summarize(r, mid)),
    start: {
      keys: Object.keys(start),
      idMatchesFile: start.id === id,
      cwd: start.cwd,
      parent: start.parent ? name(start.parent, 'S') : undefined,
      forkedAtMessageId: start.forkedAtMessageId ? mid(start.forkedAtMessageId) : undefined,
      title: start.title
    }
  }
}

function changed(before, after) {
  const rows = []
  for (const [id, s] of after) {
    const b = before.get(id)
    if (!b) rows.push(`${name(id, 'id')} new (${s.records.length} records)`)
    else if (b.sha !== s.sha || b.settingsSha !== s.settingsSha) {
      rows.push(`${name(id, 'id')} changed: records ${b.records.length}->${s.records.length}, transcript ${b.sha !== s.sha ? 'bytes differ' : 'same'}, settings ${b.settingsSha !== s.settingsSha ? 'differ' : 'same'}`)
    }
  }
  return rows.length ? rows : ['nothing changed']
}

// P0: seed S with one failed-auth turn (always the made-up key).
const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
if (!S) throw new Error(`initialize failed: ${mask(JSON.stringify(init.error))}`)
name(S, 'S')
await p0.request('droid.add_user_message', { text: 'FORK-PROBE-SEED' })
await waitFor(() => outcomes(listSessions(sb), S) >= 1)
await p0.close()
const seeded = listSessions(sb)
step('seeded S', { S: view(seeded, S) })

// P1: load S, fork, then write.
const notes = []
let F = null
const p1 = startDroid(sb, {
  tag: 'p1-fork', version, mode, mask,
  onNotification: (n) => {
    const sid = n.sessionId === S ? 'S' : n.sessionId === F ? 'F' : n.sessionId ? 'other' : null
    notes.push(sid ? `${n.type}:${sid}` : n.type)
  }
})
const countNotes = () => Object.entries(notes.splice(0).reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {})).map(([k, v]) => `${k} x${v}`)
const load = await p1.request('droid.load_session', { sessionId: S })
step('P1 load_session(S)', { error: load.error ? mask(JSON.stringify(load.error)) : null, sessionKeys: Object.keys(load.result?.session ?? {}), titleReported: load.result?.session?.title, cwdReported: mask(String(load.result?.cwd ?? '')), messages: load.result?.session?.messages?.length ?? null, notifications: countNotes() })
const afterLoad = listSessions(sb)
notes.length = 0

const fork = await p1.request('droid.fork_session', {})
F = fork.result?.newSessionId ?? null
if (F) name(F, 'F')
await new Promise((r) => setTimeout(r, 1500))
const afterFork = listSessions(sb)
step('P1 fork_session', {
  error: fork.error ? mask(JSON.stringify(fork.error)) : null,
  resultKeys: Object.keys(fork.result ?? {}),
  newSessionIdIsNew: F !== S,
  notificationsDuringFork: countNotes(),
  filesChanged: changed(afterLoad, afterFork),
  S: view(afterFork, S),
  F: F ? view(afterFork, F) : null,
  forkCopiesSMessageIds: F ? JSON.stringify(afterFork.get(F)?.records.filter((r) => r.type === 'message').map((r) => r.id)) === JSON.stringify(afterFork.get(S)?.records.filter((r) => r.type === 'message').map((r) => r.id)) : null
})

async function writeProbe(label, titleText, messageText) {
  const before = listSessions(sb)
  const rename = await p1.request('droid.rename_session', { title: titleText })
  await new Promise((r) => setTimeout(r, 1500))
  const afterRename = listSessions(sb)
  const row = {
    renameError: rename.error ? mask(JSON.stringify(rename.error)) : null,
    renameChanged: changed(before, afterRename),
    titles: { S: afterRename.get(S)?.records[0]?.title, F: F ? afterRename.get(F)?.records[0]?.title : null },
    renameNotifications: countNotes()
  }
  if (mode === 'bad') {
    const counts = { S: outcomes(afterRename, S), F: outcomes(afterRename, F) }
    const add = await p1.request('droid.add_user_message', { text: messageText })
    await waitFor(() => { const s = listSessions(sb); return outcomes(s, S) > counts.S || outcomes(s, F) > counts.F }, 15000)
    const afterMsg = listSessions(sb)
    row.messageError = add.error ? mask(JSON.stringify(add.error)) : null
    row.messageChanged = changed(afterRename, afterMsg)
    row.messageNotifications = countNotes()
    row.S = view(afterMsg, S)?.records
    row.F = view(afterMsg, F)?.records
  }
  step(label, row)
}

await writeProbe('P1 writes after fork (process never reloaded)', 'FORK-PROBE-RENAME-1', 'FORK-PROBE-AFTER-FORK')

// Same process switches to the fork.
const loadF = await p1.request('droid.load_session', { sessionId: F })
step('P1 load_session(F) in the same process', { error: loadF.error ? mask(JSON.stringify(loadF.error)) : null, titleReported: loadF.result?.session?.title, messages: loadF.result?.session?.messages?.length ?? null, notifications: countNotes() })
await writeProbe('P1 writes after load_session(F)', 'FORK-PROBE-RENAME-2', 'FORK-PROBE-AFTER-LOAD-F')
const p1exit = await p1.close()
step('P1 exit', { code: p1exit.code, signal: p1exit.signal, stderrFirst200: mask(p1.stderr.join('')).slice(0, 200) })

// P2: a fresh process opens the fork.
const p2 = startDroid(sb, { tag: 'p2-open-fork', version, mode, mask })
const loadP2 = await p2.request('droid.load_session', { sessionId: F })
step('P2 (new process) load_session(F)', {
  error: loadP2.error ? mask(JSON.stringify(loadP2.error)) : null,
  titleReported: loadP2.result?.session?.title,
  cwdReported: mask(String(loadP2.result?.session?.cwd ?? loadP2.result?.cwd ?? '')),
  messages: loadP2.result?.session?.messages?.length ?? null
})
await p2.close()
step('final files', { S: view(listSessions(sb), S), F: view(listSessions(sb), F) })

const path = writeResult(sb, `s1-${version}-${mode}`, out, mask)
console.log(`wrote ${path}`)
console.log(mask(JSON.stringify(out, null, 1)))
