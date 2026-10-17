// PAID turn 1 of 4 (approved): session recorded in A, loaded by a process started in B, one pwd prompt.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, startDroid, sleep } from './lib.mjs'
import { MODEL, PROMPT, paidEnv, mask, findSessionFile, evidence, waitForOutcome, lineCount } from './paid-lib.mjs'

const A = join(ROOT, 'proj-a'), B = join(ROOT, 'proj-b')
const err = (r) => (r.error ? `error ${mask(JSON.stringify(r.error)).slice(0, 220)}` : 'ok')

// Free: record Z in A (no prompt).
const pa = startDroid({ tag: 'p1-A', cwd: A, env: paidEnv('Z-init-A') })
const init = await pa.request('droid.initialize_session', { machineId: 'probe-machine', cwd: A, interactionMode: 'auto', autonomyLevel: 'low', ...MODEL })
const Z = init.result?.sessionId
console.log('Z recorded in A:', err(init), '| id', mask(Z))
await sleep(800)
await pa.close()
writeFileSync(join(ROOT, 'out', 'Z.id'), Z)

// Paid: process started in B loads Z, then one prompt.
const pb = startDroid({ tag: 'p1-B', cwd: B, env: paidEnv('S1-load-from-B'), onRequest: (f) => console.log('SERVER REQUEST (unexpected):', f.method) })
const load = await pb.request('droid.load_session', { sessionId: Z })
console.log('load from B:', err(load), '| result.cwd', load.result?.cwd?.replace('/private/tmp/droid-28/', ''))
const upd = await pb.request('droid.update_session_settings', { ...MODEL, interactionMode: 'auto', autonomyLevel: 'low' })
console.log('pin model/autonomy:', err(upd))
await sleep(800)
const file = findSessionFile(Z)
const before = lineCount(file)
console.log('>>> sending the pwd prompt (credits are spent now)')
const add = await pb.request('droid.add_user_message', { text: PROMPT })
console.log('add_user_message:', err(add))
const done = await waitForOutcome(file, before)
console.log('turn finished:', done)
if (!done) await pb.request('droid.interrupt_session', {})
console.log(evidence(file, before).text)
await pb.close()
