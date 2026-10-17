// Credit-free (invalid key): load a session whose recorded folder no longer exists.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, cleanEnv, startDroid, sleep } from './lib.mjs'

const B = join(ROOT, 'proj-b'), D = join(ROOT, 'proj-d')
const BAD = { FACTORY_API_KEY: 'fk-invalid-orca-probe-28' }
const mask = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => m.slice(0, 8)).replaceAll('/private/tmp/droid-28/', '').replaceAll('/tmp/droid-28/', '')
const err = (r) => (r.error ? `error ${mask(JSON.stringify(r.error)).slice(0, 260)}` : 'ok')

mkdirSync(D, { recursive: true })
const pd = startDroid({ tag: 'c3-D', cwd: D, env: cleanEnv({ ...BAD, PROBE_TAG: 'D-init' }) })
const init = await pd.request('droid.initialize_session', { machineId: 'probe-machine', cwd: D, interactionMode: 'auto', autonomyLevel: 'low' })
const W = init.result?.sessionId
await pd.close()
rmSync(D, { recursive: true, force: true })
console.log('session recorded in a folder that is now deleted:', mask(W))

const pb = startDroid({ tag: 'c3-B', cwd: B, env: cleanEnv({ ...BAD, PROBE_TAG: 'missing-folder' }) })
const load = await pb.request('droid.load_session', { sessionId: W })
console.log('load_session:', err(load), '| result.cwd', mask(load.result?.cwd))
const add = await pb.request('droid.add_user_message', { text: 'probe prompt (invalid key)' })
console.log('add_user_message:', err(add))
await sleep(3000)
await pb.close()
