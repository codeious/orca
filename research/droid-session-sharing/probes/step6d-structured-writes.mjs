// Credit-free (invalid key): a structured process attaches to a session a live TUI holds and sends a message.
import { readFileSync } from 'node:fs'
import { cleanEnv, startDroid, sleep } from './lib.mjs'
const [X, file] = process.argv.slice(2)
const B = startDroid({ tag: 'step6d-B', env: cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' }) })
const load = await B.request('droid.load_session', { sessionId: X })
console.log('structured load_session while TUI holds:', load.error ? JSON.stringify(load.error).slice(0, 300) : `ok, workingState ${load.result?.workingState}, messages ${load.result?.session?.messages?.length}`)
const add = await B.request('droid.add_user_message', { text: 'STRUCT-MARK: second writer next to a live TUI' })
console.log('structured add_user_message:', add.error ? JSON.stringify(add.error).slice(0, 300) : 'accepted')
await sleep(4000)
const recs = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
console.log('transcript tail after structured write:')
for (const r of recs.slice(-5)) console.log(r.type === 'message' ? `seq=${r.seq} role=${r.message.role} src=${r.message.userMessageSource ?? '(none)'} vis=${r.visibility ?? r.message.visibility ?? 'visible'} parent=${String(r.parentId ?? '-').slice(0, 4)}` : `${r.type} ${r.reason ?? ''}`)
await B.close()
