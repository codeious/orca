// Credit-free (invalid key): does a session resolve by id when the loading process runs in a different folder?
import { mkdirSync } from 'node:fs'
import { cleanEnv, startDroid, maskIds } from './lib.mjs'
const X = process.argv[2]
const OTHER = '/tmp/droid-23/other-folder'
mkdirSync(OTHER, { recursive: true })
const B = startDroid({ tag: 'step7', cwd: OTHER, env: cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' }) })
const load = await B.request('droid.load_session', { sessionId: X })
console.log('load_session from another folder:', load.error ? `error ${maskIds(JSON.stringify(load.error)).slice(0, 300)}` : `ok, messages ${load.result?.session?.messages?.length}, result.cwd ${load.result?.cwd}`)
const bogus = await B.request('droid.load_session', { sessionId: '00000000-0000-4000-8000-000000000000' })
console.log('load_session with an unknown id:', bogus.error ? `error ${maskIds(JSON.stringify(bogus.error)).slice(0, 300)}` : 'ok?!')
await B.close()
