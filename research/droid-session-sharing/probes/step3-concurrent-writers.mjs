// Credit-free (invalid API key): two live processes on one session. Does the loser's write collide on seq/parentId?
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, PROJ_DIR, cleanEnv, startDroid, sleep, maskIds } from './lib.mjs'

const BAD = cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' })
const dir = () => { const r = join(HOME_DIR, '.factory', 'sessions'); return join(r, readdirSync(r).find((n) => n.startsWith('-'))) }
const rows = (id) => readFileSync(join(dir(), `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const short = (s) => (s ? String(s).slice(0, 4) : '-')
function table(label, id) {
  console.log(`--- ${label} ---`)
  for (const r of rows(id)) {
    if (r.type !== 'message') { console.log(`${r.type}${r.reason ? ' ' + r.reason : ''}`); continue }
    const text = (r.message.content?.[0]?.text ?? '').slice(0, 24).replace(/\n/g, ' ')
    console.log(`seq=${r.seq} id=${short(r.id)} parent=${short(r.parentId)} role=${r.message.role} vis=${r.visibility ?? r.message.visibility ?? 'visible'} "${text}"`)
  }
}

const A = startDroid({ tag: 'step3-A', env: BAD })
const init = await A.request('droid.initialize_session', { machineId: 'probe-machine', cwd: PROJ_DIR, interactionMode: 'auto', autonomyLevel: 'off' })
const X = init.result.sessionId
await A.request('droid.add_user_message', { text: 'A-1' })
await sleep(3000)

// B attaches while A is idle, then A writes again before B writes.
const B = startDroid({ tag: 'step3-B', env: BAD })
await B.request('droid.load_session', { sessionId: X })
await sleep(500)
await A.request('droid.add_user_message', { text: 'A-2 (after B loaded)' })
await sleep(3000)
await B.request('droid.add_user_message', { text: 'B-1 (stale view)' })
await sleep(3000)
table('A-1, then B loaded, then A-2, then B-1', X)

// Both write at once.
await Promise.all([A.request('droid.add_user_message', { text: 'A-3 (simultaneous)' }), B.request('droid.add_user_message', { text: 'B-2 (simultaneous)' })])
await sleep(4000)
table('after simultaneous A-3 / B-2', X)

// A third process loads from disk and sees what?
const C = startDroid({ tag: 'step3-C', env: BAD })
const loadC = await C.request('droid.load_session', { sessionId: X })
const msgs = loadC.result?.session?.messages ?? []
console.log('C loaded messages:', msgs.length, 'seqs:', msgs.map((m) => m.seq).join(','))
await C.close(); await B.close(); await A.close()
