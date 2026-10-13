// Credit-free (invalid key): a structured process loads a session the interactive TUI created. Usage: node step5-load-tui-session.mjs <id-prefix>
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, PROJ_DIR, cleanEnv, startDroid, sleep, maskIds } from './lib.mjs'

const prefix = process.argv[2]
const dir = join(HOME_DIR, '.factory', 'sessions', '-private-tmp-droid-23-proj')
const file = readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith('.jsonl'))
const X = file.replace('.jsonl', '')
const shape = (v) => (typeof v === 'string' ? (v.length > 40 ? `"${v.slice(0, 40)}…"(${v.length})` : JSON.stringify(v)) : Array.isArray(v) ? `[${v.slice(0, 2).map(shape).join(',')}${v.length > 2 ? ',…' : ''}]` : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x)}`).join(', ')}}` : String(v))
const dump = (label) => {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)
  console.log(`--- transcript ${label}: ${lines.length} record(s)`)
  for (const l of lines) console.log(maskIds(shape(JSON.parse(l))))
}
dump('as the TUI left it')
console.log('settings keys:', Object.keys(JSON.parse(readFileSync(join(dir, `${X}.settings.json`), 'utf8'))).join(','), '| model:', JSON.parse(readFileSync(join(dir, `${X}.settings.json`), 'utf8')).model)

const B = startDroid({ tag: 'step5-B', env: cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' }) })
const load = await B.request('droid.load_session', { sessionId: X })
console.log('load_session error:', load.error ? JSON.stringify(load.error).slice(0, 300) : 'none')
const r = load.result ?? {}
console.log('result keys:', Object.keys(r).join(','))
console.log('result carries a session id field:', ['sessionId', 'id'].filter((k) => k in r || k in (r.session ?? {})).join(',') || 'none')
console.log('messages:', (r.session?.messages ?? []).length, '| title:', maskIds(r.session?.title ?? ''), '| cwd:', r.cwd, '| workingState:', r.workingState)
console.log('settings model:', r.settings?.modelId, '| effort:', r.settings?.reasoningEffort)
await sleep(800)
dump('after structured load (no prompt)')
await B.close()
