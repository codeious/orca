// Credit-free (invalid API key): does a failed turn persist a user message, and what does a second process do on a held session?
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, PROJ_DIR, cleanEnv, snap, startDroid, sleep, maskIds } from './lib.mjs'

const BAD = cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' })
const sessionsDir = () => {
  const root = join(HOME_DIR, '.factory', 'sessions')
  return join(root, readdirSync(root)[0])
}
function shape(v) {
  if (typeof v === 'string') return v.length > 40 ? `${JSON.stringify(v.slice(0, 40))}…(${v.length})` : JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.slice(0, 2).map(shape).join(', ')}${v.length > 2 ? ', …' : ''}]`
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}: ${shape(x)}`).join(', ')}}`
  return String(v)
}
function dumpTranscript(label, id) {
  const lines = readFileSync(join(sessionsDir(), `${id}.jsonl`), 'utf8').split('\n').filter(Boolean)
  console.log(`--- transcript (${label}): ${lines.length} record(s) ---`)
  for (const l of lines) console.log(maskIds(shape(JSON.parse(l))))
}
const typeCounts = (store) => (n) => { store[n.type] = (store[n.type] ?? 0) + 1 }

// Process A: initialize, then send a prompt that cannot reach a model.
const aTypes = {}
const A = startDroid({ tag: 'step2-A', env: BAD, onNotification: typeCounts(aTypes) })
const initA = await A.request('droid.initialize_session', { machineId: 'probe-machine', cwd: PROJ_DIR, interactionMode: 'auto', autonomyLevel: 'off' })
console.log('A initialize error:', initA.error ? JSON.stringify(initA.error).slice(0, 300) : 'none')
const X = initA.result?.sessionId
console.log('A session id shape:', maskIds(X ?? ''))
dumpTranscript('A after initialize', X)

const addA = await A.request('droid.add_user_message', { text: 'Reply with exactly the word PONG. Do not use tools.' })
console.log('A add_user_message:', addA.error ? `error ${JSON.stringify(addA.error).slice(0, 300)}` : `result keys ${Object.keys(addA.result ?? {})}`)
await sleep(5000)
console.log('A notification types:', JSON.stringify(aTypes))
dumpTranscript('A after failed prompt', X)
snap('after A failed prompt')

// Process B: same HOME, same cwd, A still alive and holding X.
const bTypes = {}
const B = startDroid({ tag: 'step2-B', env: BAD, onNotification: typeCounts(bTypes) })
const loadB = await B.request('droid.load_session', { sessionId: X })
console.log('B load_session (A alive):', loadB.error ? `error ${JSON.stringify(loadB.error).slice(0, 400)}` : `result keys ${Object.keys(loadB.result ?? {})}, sessionId same as A: ${loadB.result?.sessionId === X}`)
await sleep(1500)
dumpTranscript('after B load (A alive)', X)
const addB = await B.request('droid.add_user_message', { text: 'SECOND-PROCESS-MARK: reply with exactly the word PING.' })
console.log('B add_user_message:', addB.error ? `error ${JSON.stringify(addB.error).slice(0, 300)}` : 'ok')
await sleep(5000)
console.log('B notification types:', JSON.stringify(bTypes))
dumpTranscript('after B prompt (A alive)', X)
console.log('A notification types now:', JSON.stringify(aTypes))
snap('after B prompt')

await B.close()
await A.close()
console.log('stderr A:', maskIds(A.stderr.join('')).slice(0, 300))
console.log('stderr B:', maskIds(B.stderr.join('')).slice(0, 300))
