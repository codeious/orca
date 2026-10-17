// Credit-free (invalid key). Where does Droid think a loaded session's folder is, and can anything change it?
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, ROOT, cleanEnv, startDroid, sleep } from './lib.mjs'

const A = join(ROOT, 'proj-a')
const B = join(ROOT, 'proj-b')
const C = join(ROOT, 'proj-c')
for (const d of [A, B, C]) mkdirSync(d, { recursive: true })
const BAD = { FACTORY_API_KEY: 'fk-invalid-orca-probe-28' }
const err = (r) => (r.error ? `error ${JSON.stringify(r.error).slice(0, 260)}` : 'ok')
const fileCwds = (id) => {
  const root = join(HOME_DIR, '.factory', 'sessions')
  const out = []
  for (const slug of readdirSync(root)) {
    try {
      const f = join(root, slug, `${id}.jsonl`)
      const first = JSON.parse(readFileSync(f, 'utf8').split('\n')[0])
      out.push(`${slug} -> session_start.cwd ${first.cwd}`)
    } catch {}
  }
  return out.join(' | ') || '(no file)'
}
const sessionCwd = (r) => `result.cwd ${r.result?.cwd} | session.cwd ${r.result?.session?.cwd}`

// 1. Record a session in A.
const pa = startDroid({ tag: 'c1-A', cwd: A, env: cleanEnv({ ...BAD, PROBE_TAG: 'A-init' }) })
const init = await pa.request('droid.initialize_session', { machineId: 'probe-machine', cwd: A, interactionMode: 'auto', autonomyLevel: 'off' })
const X = init.result?.sessionId
console.log('1. init in A:', err(init), '| file:', fileCwds(X))
await pa.close()

// 2. Load from B (process cwd B).
const pb = startDroid({ tag: 'c1-B', cwd: B, env: cleanEnv({ ...BAD, PROBE_TAG: 'B-load' }) })
const load = await pb.request('droid.load_session', { sessionId: X })
console.log('2. load from B:', err(load), '|', sessionCwd(load))
await sleep(1200)

// 3. Ask a loaded session to change folder.
const chg = await pb.request('droid.change_working_directory', { workingDirectory: C })
console.log('3. change_working_directory -> C:', err(chg), '| result', JSON.stringify(chg.result), '| keys', Object.keys(chg.result ?? {}))
await sleep(800)
console.log('   session file after change:', fileCwds(X))

// 4. A prompt in the same process (auth fails, but UserPromptSubmit fires first).
const add = await pb.request('droid.add_user_message', { text: 'probe prompt (invalid key)' })
console.log('4. add_user_message in B-process after change:', err(add))
await sleep(3500)
await pb.close()

// 5. Fresh process from B reloads: what does it report now?
const pc = startDroid({ tag: 'c1-B2', cwd: B, env: cleanEnv({ ...BAD, PROBE_TAG: 'B-reload' }) })
const reload = await pc.request('droid.load_session', { sessionId: X })
console.log('5. reload from B:', err(reload), '|', sessionCwd(reload))
await pc.close()

// 6. Can initialize_session / update_session_settings take a cwd for a loaded session?
const pd = startDroid({ tag: 'c1-D', cwd: B, env: cleanEnv({ ...BAD, PROBE_TAG: 'D-init-with-id' }) })
const initId = await pd.request('droid.initialize_session', { machineId: 'probe-machine', sessionId: X, cwd: B, interactionMode: 'auto', autonomyLevel: 'off' })
console.log('6a. initialize_session with sessionId + cwd B:', err(initId), '| sessionId same:', initId.result?.sessionId === X, '|', sessionCwd(initId))
await sleep(800)
const upd = await pd.request('droid.update_session_settings', { cwd: C })
console.log('6b. update_session_settings {cwd: C}:', err(upd))
await pd.close()
console.log('final file:', fileCwds(X))
console.log('SESSION_ID', X)
