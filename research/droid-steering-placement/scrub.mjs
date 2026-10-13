import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const OUT = '/tmp/droid-steer-probe/fixtures'
mkdirSync(OUT, { recursive: true })
const KEEP = new Set([
  'create_message',
  'tool_call',
  'tool_execution_phase_changed',
  'tool_result',
  'droid_working_state_changed',
  'assistant_text_complete',
  'agent_turn_completed',
  'queued_messages_discarded'
])
const RUNS = {
  'end-of-turn': 'run-end_of_turn.gpt-5.4-mini',
  'end-of-loop': 'run-end_of_loop.gpt-5.4-mini',
  'end-of-turn-late': 'late-end_of_turn.gpt-5.4-mini',
  'end-of-turn-interrupt': 'interrupt-end_of_turn.gpt-5.4-mini'
}

function scrubBlocks(content) {
  return content?.map((c) => (c.type === 'thinking' && 'signature' in c ? { ...c, signature: '<elided>' } : c))
}

let credits = 0
for (const [name, src] of Object.entries(RUNS)) {
  const rows = readFileSync(`/tmp/droid-steer-probe/out/${src}.raw.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const kept = []
  for (const { t, dir, frame: f } of rows) {
    if (dir === 'mark') {
      if (f.event !== 'wait_done' && f.event !== 'exit') kept.push({ t, dir, frame: f })
      continue
    }
    const frame = structuredClone(f)
    delete frame._meta
    if (dir === 'in') {
      if (frame.type === 'response' && frame.id === 'r1') {
        frame.result = { sessionId: frame.result.sessionId, elided: ['hostId', 'session', 'settings', 'availableModels'] }
      } else if (frame.type === 'notification') {
        const n = frame.params?.notification
        if (!n || !KEEP.has(n.type)) continue
        if (n.type === 'create_message') n.message.content = scrubBlocks(n.message.content)
        if (n.type === 'agent_turn_completed') credits += n.tokenUsage?.factoryCredits ?? 0
      }
    } else if (frame.method === 'droid.initialize_session') {
      frame.params.cwd = '<tmp-cwd>'
    }
    kept.push({ t, dir, frame })
  }
  // Renumber opaque ids consistently per file.
  let text = kept.map((r) => JSON.stringify(r)).join('\n') + '\n'
  const sid = JSON.parse(kept.find((r) => r.dir === 'in' && r.frame.id === 'r1').frame && JSON.stringify(kept.find((r) => r.dir === 'in' && r.frame.id === 'r1').frame)).result.sessionId
  text = text.split(sid).join('<session-id>')
  const maps = { uuid: new Map(), call: new Map() }
  const num = (m, v, p) => (m.has(v) ? m.get(v) : (m.set(v, `<${p}-${m.size + 1}>`), m.get(v)))
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (v) => num(maps.uuid, v, 'id'))
  text = text.replace(/\bcall_[A-Za-z0-9]+\b/g, (v) => num(maps.call, v, 'call'))
  text = text.replace(/\/tmp\/droid-steer-cwd-[A-Za-z0-9]+/g, '<tmp-cwd>')
  writeFileSync(`${OUT}/${name}.jsonl`, text)
  console.log(name, kept.length, 'frames', text.length, 'bytes')
}
console.log('factoryCredits reported across the 4 fixture runs (Droid units):', credits)
