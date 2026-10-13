// Credit-free (invalid key): does droid.load_session take a cwd, and does the loaded session report it?
import { mkdirSync } from 'node:fs'
import { cleanEnv, startDroid, maskIds } from './lib.mjs'
const X = process.argv[2]
const OTHER = '/tmp/droid-23/other-folder'
mkdirSync(OTHER, { recursive: true })
const B = startDroid({ tag: 'step8', cwd: OTHER, env: cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' }) })
const show = (label, res) =>
  console.log(label, res.error ? `error ${maskIds(JSON.stringify(res.error)).slice(0, 240)}` : `ok, result.cwd ${maskIds(res.result?.cwd)}, session.cwd ${maskIds(res.result?.session?.cwd)}, result keys [${Object.keys(res.result ?? {}).join(',')}]`)
show('load_session with cwd param:', await B.request('droid.load_session', { sessionId: X, cwd: OTHER }))
await B.close()
