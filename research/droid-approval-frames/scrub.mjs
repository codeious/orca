// Scrubs raw probe logs into committed fixtures. Usage: PROBE_MODEL=<model id passed to probe.mjs> node scrub.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const MODEL = process.env.PROBE_MODEL
if (!MODEL) throw new Error('set PROBE_MODEL to the model id used for the paid runs')
const IN = '/tmp/droid-approval-probe/out'
const OUT = '/tmp/droid-approval-probe/fixtures'
mkdirSync(OUT, { recursive: true })

const RUNS = {
  'update-settings-acks': 'settings.raw.jsonl',
  'autonomy-cap-clamp': 'cap.raw.jsonl',
  'autonomy-off-exec-and-patch': `off.${MODEL}.raw.jsonl`,
  'autonomy-high-rules': `high-rules.${MODEL}.raw.jsonl`,
  'legacy-blocklist-and-denylist': `legacy-block.${MODEL}.raw.jsonl`,
  'spec-plan-approval-off': `spec-off.${MODEL}.raw.jsonl`,
  'spec-plan-approval-high': `spec-high.${MODEL}.raw.jsonl`,
  'model-blocked-by-org': 'model.gpt-5.4-mini.raw.jsonl',
  'model-substituted-turn-error': 'off.gpt-5.4-mini.raw.jsonl'
}
const KEEP_NOTIFICATIONS = new Set([
  'create_message',
  'tool_call',
  'tool_execution_phase_changed',
  'tool_result',
  'droid_working_state_changed',
  'assistant_text_complete',
  'permission_resolved',
  'settings_updated',
  'agent_turn_completed',
  'error'
])
const KEEP_MARKS = new Set(['turn_start', 'turn_done', 'permission_answer', 'update_settings', 'update_settings_response', 'pin_model', 'pin_spec_model'])

let credits = 0
for (const [name, src] of Object.entries(RUNS)) {
  const rows = readFileSync(`${IN}/${src}`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const lastToolCall = new Map()
  rows.forEach((r, i) => {
    const n = r.frame?.params?.notification
    if (r.dir === 'in' && n?.type === 'tool_call') lastToolCall.set(n.toolUse.id, i)
  })
  const kept = []
  rows.forEach(({ t, dir, frame: f }, i) => {
    if (dir === 'mark') {
      if (KEEP_MARKS.has(f.event)) kept.push({ t, dir, frame: f })
      return
    }
    const frame = structuredClone(f)
    delete frame._meta
    if (dir === 'in') {
      if (frame.type === 'response' && frame.result?.sessionId) {
        frame.result = { sessionId: frame.result.sessionId, settings: frame.result.settings, elided: ['hostId', 'session', 'availableModels', 'messages'] }
      } else if (frame.type === 'notification') {
        const n = frame.params?.notification
        if (!n || !KEEP_NOTIFICATIONS.has(n.type)) return
        if (n.type === 'tool_call' && lastToolCall.get(n.toolUse.id) !== i) return
        if (n.type === 'create_message' && n.message.visibility === 'llm_only') return
        if (n.type === 'agent_turn_completed') credits += n.tokenUsage?.factoryCredits ?? 0
      } else if (frame.type === 'request' && frame.method !== 'droid.request_permission') return
    } else if (frame.method === 'droid.initialize_session') {
      frame.params.cwd = '<tmp-cwd>'
      frame.params.machineId = '<machine-id>'
    }
    kept.push({ t, dir, frame })
  })

  let text = kept.map((r) => JSON.stringify(r)).join('\n') + '\n'
  const sid = kept.find((r) => r.dir === 'in' && r.frame.result?.sessionId)?.frame.result.sessionId
  if (sid) text = text.split(sid).join('<session-id>')
  const maps = { uuid: new Map(), call: new Map(), model: new Map() }
  const num = (m, v, p) => (m.has(v) ? m.get(v) : (m.set(v, `<${p}-${m.size + 1}>`), m.get(v)))
  text = text.replace(/(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/g, (v) => num(maps.uuid, v, 'id'))
  text = text.replace(/\bcall_[A-Za-z0-9]+\b/g, (v) => num(maps.call, v, 'call'))
  text = text.replace(/custom:[A-Za-z0-9._:-]*[A-Za-z0-9]/g, (v) => num(maps.model, v, 'custom-model'))
  text = text.replace(/(?:\/private)?\/tmp\/droid-approval-cwd-[A-Za-z0-9]+/g, '<tmp-cwd>')
  writeFileSync(`${OUT}/${name}.jsonl`, text)
  console.log(name.padEnd(32), String(kept.length).padStart(4), 'frames', String(text.length).padStart(7), 'bytes')
}
console.log('factoryCredits reported across the fixture runs (Droid units):', credits)
