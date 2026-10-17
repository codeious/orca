// Credit-free (invalid key). exec -s / --fork / --cwd from another folder, structured fork_session, duplicate-id load.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, ROOT, cleanEnv, startDroid, sleep } from './lib.mjs'

const A = join(ROOT, 'proj-a'), B = join(ROOT, 'proj-b'), C = join(ROOT, 'proj-c')
const BAD = { FACTORY_API_KEY: 'fk-invalid-orca-probe-28' }
const mask = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => m.slice(0, 8))
const err = (r) => (r.error ? `error ${mask(JSON.stringify(r.error)).slice(0, 220)}` : 'ok')

function table(label) {
  const root = join(HOME_DIR, '.factory', 'sessions')
  const rows = []
  for (const slug of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const f of readdirSync(join(root, slug)).filter((n) => n.endsWith('.jsonl')).sort()) {
      const lines = readFileSync(join(root, slug, f), 'utf8').split('\n').filter(Boolean)
      const s = JSON.parse(lines[0])
      rows.push(`  ${slug.replace('-private-tmp-droid-28-', '')} | ${f.slice(0, 8)} | cwd ${s.cwd?.replace('/tmp/droid-28/', '')} | parent ${s.parent ? s.parent.slice(0, 8) : '-'} | records ${lines.length}`)
    }
  }
  console.log(`--- sessions (${label}) ---\n${rows.join('\n')}`)
}
function run(tag, cwd, args) {
  const r = spawnSync('droid', args, { cwd, env: cleanEnv({ ...BAD, PROBE_TAG: tag }), encoding: 'utf8', timeout: 90000 })
  const o = mask((r.stdout ?? '').slice(0, 140).replace(/\s+/g, ' '))
  const e = mask((r.stderr ?? '').slice(0, 200).replace(/\s+/g, ' '))
  console.log(`${tag}: exit ${r.status}${r.signal ? ` ${r.signal}` : ''} | stdout: ${o || '-'} | stderr: ${e || '-'}`)
}

// Fresh session Y recorded in A.
const pa = startDroid({ tag: 'c2-A', cwd: A, env: cleanEnv({ ...BAD, PROBE_TAG: 'Y-init' }) })
const init = await pa.request('droid.initialize_session', { machineId: 'probe-machine', cwd: A, interactionMode: 'auto', autonomyLevel: 'off' })
const Y = init.result?.sessionId
await pa.close()
console.log('Y recorded in A, id', mask(Y))
table('after Y init')

run('exec-s-B', B, ['exec', '-s', Y, 'probe prompt'])
run('exec-s-B-cwdC', B, ['exec', '-s', Y, '--cwd', C, 'probe prompt'])
run('exec-fork-B', B, ['exec', '--fork', Y, 'probe prompt'])
run('exec-fork-B-cwdC', B, ['exec', '--fork', Y, '--cwd', C, 'probe prompt'])
table('after exec runs')

// Structured fork_session from a process in B that loaded Y.
const pb = startDroid({ tag: 'c2-B', cwd: B, env: cleanEnv({ ...BAD, PROBE_TAG: 'fork-session-B' }) })
const load = await pb.request('droid.load_session', { sessionId: Y })
console.log('load Y from B:', err(load), '| result.cwd', load.result?.cwd?.replace('/private/tmp/droid-28/', ''))
const fk = await pb.request('droid.fork_session', { title: 'probe fork' })
console.log('droid.fork_session:', err(fk), '| result keys', Object.keys(fk.result ?? {}).join(','), '| new id', mask(fk.result?.sessionId ?? fk.result?.session?.id ?? ''), '| cwd', (fk.result?.cwd ?? fk.result?.session?.cwd ?? '-').replace('/private/tmp/droid-28/', ''))
await sleep(1000)
await pb.close()
table('after fork_session')

// Duplicate-id from c1: which file does load_session pick? (X is in slug a with history and slug b with 2 records.)
const X = process.argv[2]
if (X) {
  for (const [label, cwd] of [['A', A], ['B', B], ['C', C]]) {
    const p = startDroid({ tag: `c2-dup-${label}`, cwd, env: cleanEnv({ ...BAD, PROBE_TAG: `dup-${label}` }) })
    const l = await p.request('droid.load_session', { sessionId: X })
    console.log(`load duplicated id from ${label}:`, err(l), '| messages', l.result?.session?.messages?.length, '| result.cwd', l.result?.cwd?.replace('/private/tmp/droid-28/', ''))
    await p.close()
  }
}
