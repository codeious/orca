// Credit-free (invalid key). usage: node s1-structured.mjs <version-label>
// Process chain from a structured droid (stream-jsonrpc) to its hook command, across SessionStart, UserPromptSubmit, SessionEnd and a reload.
import { BINS, PROJ_DIR, cleanEnv, mark, sleep, startDroid } from './lib.mjs'

const label = process.argv[2]
const bin = BINS[label]
if (!bin) throw new Error(`unknown label ${label}`)
const env = cleanEnv(label, { FACTORY_API_KEY: ['fk', 'invalid-orca-probe-31'].join('-') })
const ok = (r) => (r.error ? `error ${JSON.stringify(r.error).slice(0, 200)}` : 'ok')

// Process 1: init, prompt (auth fails, UserPromptSubmit fires first), close.
const p1 = startDroid({ label, bin, tag: `${label}/s1-init`, env })
const id1 = mark(label, 'p1-spawned', p1.child.pid)
console.log('p1 droid identity (outside):', JSON.stringify(id1))
const init = await p1.request('droid.initialize_session', { machineId: 'probe-machine', cwd: PROJ_DIR, interactionMode: 'auto', autonomyLevel: 'off' })
const sessionId = init.result?.sessionId
console.log('p1 initialize_session:', ok(init))
await sleep(1500)
mark(label, 'p1-after-init', p1.child.pid)
const add = await p1.request('droid.add_user_message', { text: 'probe prompt (invalid key)' })
console.log('p1 add_user_message:', ok(add))
await sleep(3500)
const id1b = mark(label, 'p1-before-close', p1.child.pid)
console.log('p1 identity unchanged across events:', id1.start === id1b.start && id1.pid === id1b.pid)
const exit1 = await p1.close()
await sleep(500)
const gone = mark(label, 'p1-after-exit', p1.child.pid)
console.log('p1 exit:', JSON.stringify(exit1), '| identity after exit resolves:', gone.alive)

// Process 2: a fresh process loads the same session (resume shape).
const p2 = startDroid({ label, bin, tag: `${label}/s1-load`, env })
const id2 = mark(label, 'p2-spawned', p2.child.pid)
const load = await p2.request('droid.load_session', { sessionId })
console.log('p2 load_session:', ok(load), '| pid differs from p1:', id2.pid !== id1.pid)
await sleep(1500)
await p2.close()
await sleep(500)
mark(label, 'p2-after-exit', p2.child.pid)
console.log('done', label)
