// usage: node s6-fork-session-params.mjs <version>
// fork_session with nothing loaded, and with title/tags. Made-up key; no model call beyond the seed turn.
import { listSessions, makeMasker, sandbox, startDroid, waitFor, writeResult } from './lib.mjs'

const [version] = process.argv.slice(2)
const sb = sandbox(`s6-${version}`)
const { mask, name } = makeMasker(sb)
const out = { version, mode: 'bad' }

const p0 = startDroid(sb, { tag: 'p0-seed', version, mode: 'bad', mask, cwd: sb.a })
const init = await p0.request('droid.initialize_session', { machineId: 'probe-machine', cwd: sb.a, interactionMode: 'auto', autonomyLevel: 'off' })
const S = init.result?.sessionId
name(S, 'S')
await p0.request('droid.add_user_message', { text: 'FORK-PROBE-SEED' })
await waitFor(() => listSessions(sb).get(S)?.records.some((r) => r.type === 'agent_turn_outcome'))
await p0.close()

// 1. Nothing loaded.
{
  const before = listSessions(sb)
  const p = startDroid(sb, { tag: 'nothing-loaded', version, mode: 'bad', mask, cwd: sb.a })
  const r = await p.request('droid.fork_session', {})
  out.nothingLoaded = { error: r.error ? mask(JSON.stringify(r.error)).slice(0, 300) : null, resultKeys: Object.keys(r.result ?? {}), newFiles: [...listSessions(sb)].filter(([id]) => !before.has(id)).length }
  await p.close()
}

// 2. title and tags.
{
  const before = listSessions(sb)
  const p = startDroid(sb, { tag: 'titled', version, mode: 'bad', mask, cwd: sb.a })
  await p.request('droid.load_session', { sessionId: S })
  const r = await p.request('droid.fork_session', { title: 'FORK-PROBE-TITLED', tags: [{ name: 'probe' }] })
  const r2 = await p.request('droid.fork_session', { title: 'FORK-PROBE-TITLED-2', tags: ['probe'] })
  const files = [...listSessions(sb)].filter(([id]) => !before.has(id))
  out.titled = {
    withTagObject: { error: r.error ? mask(JSON.stringify(r.error)).slice(0, 300) : null, resultKeys: Object.keys(r.result ?? {}) },
    withTagString: { error: r2.error ? mask(JSON.stringify(r2.error)).slice(0, 300) : null, resultKeys: Object.keys(r2.result ?? {}) },
    newFiles: files.map(([id, s]) => ({ id: name(id, 'F'), title: s.records[0].title, isSessionTitleManuallySet: s.records[0].isSessionTitleManuallySet, startKeys: Object.keys(s.records[0]), tags: s.records[0].tags ?? null }))
  }
  await p.close()
}

console.log(`wrote ${writeResult(sb, `s6-${version}`, out, mask)}`)
