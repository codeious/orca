// PAID turn 4 of 4 (approved): load Z (recorded in A) from B, change_working_directory to trusted C, one pwd prompt.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, startDroid, sleep } from './lib.mjs'
import { MODEL, PROMPT, paidEnv, mask, findSessionFile, evidence, waitForOutcome, lineCount } from './paid-lib.mjs'

const B = join(ROOT, 'proj-b'), C = join(ROOT, 'proj-c')
const Z = readFileSync(join(ROOT, 'out', 'Z.id'), 'utf8').trim()
const err = (r) => (r.error ? `error ${mask(JSON.stringify(r.error)).slice(0, 240)}` : 'ok')
const rel = (s) => String(s).replace('/private/tmp/droid-28/', '').replace('/tmp/droid-28/', '')
const file = findSessionFile(Z)

const notes = []
const pb = startDroid({ tag: 'p4-B', cwd: B, env: paidEnv('S4-change-dir'), onNotification: (n) => notes.push(n.type) })
const load = await pb.request('droid.load_session', { sessionId: Z })
console.log('load from B:', err(load), '| result.cwd', rel(load.result?.cwd))
await pb.request('droid.update_session_settings', { ...MODEL, interactionMode: 'auto', autonomyLevel: 'low' })
await sleep(800)

const n0 = lineCount(file)
const chg = await pb.request('droid.change_working_directory', { workingDirectory: C })
console.log('change_working_directory -> C:', err(chg), '| result', rel(JSON.stringify(chg.result)))
await sleep(1000)
console.log('records written by the change:', lineCount(file) - n0, '| notifications seen:', [...new Set(notes)].join(','))

const before = lineCount(file)
console.log('>>> sending the pwd prompt (credits are spent now)')
const add = await pb.request('droid.add_user_message', { text: PROMPT })
console.log('add_user_message:', err(add))
const done = await waitForOutcome(file, before)
console.log('turn finished:', done)
if (!done) await pb.request('droid.interrupt_session', {})
console.log(rel(evidence(file, before).text))
await pb.close()

// Free follow-up: did the change persist for a fresh process started in B?
const pc = startDroid({ tag: 'p4-B2', cwd: B, env: paidEnv('S4-reload') })
const re = await pc.request('droid.load_session', { sessionId: Z })
console.log('fresh load from B afterwards:', err(re), '| result.cwd', rel(re.result?.cwd))
await pc.close()
const first = JSON.parse(readFileSync(file, 'utf8').split('\n')[0])
console.log('session_start.cwd in file:', rel(first.cwd), '| slug dir:', rel(file.split('/').slice(-2)[0]))
