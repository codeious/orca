import { readFileSync } from 'node:fs'

const file = process.argv[2]
const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const skip = new Set(['assistant_text_delta', 'thinking_text_delta', 'mcp_status_changed', 'session_token_usage_changed', 'hook_execution_started', 'hook_execution_completed'])
const clip = (s, n = 90) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').slice(0, n) : s)

for (const { t, dir, frame: f } of rows) {
  const ts = String(t).padStart(6)
  if (dir === 'mark') {
    console.log(`${ts} MARK ${JSON.stringify(f)}`)
    continue
  }
  if (dir === 'out') {
    const p = f.params ?? {}
    const detail = f.method === 'droid.add_user_message' ? `text=${clip(p.text, 60)} placement=${p.queuePlacement ?? '-'}` : ''
    console.log(`${ts} OUT ${f.type} ${f.method ?? ''} ${f.id} ${detail}`)
    continue
  }
  if (f.type === 'response') {
    console.log(`${ts} IN  response ${f.id} ${f.error ? `ERROR ${clip(JSON.stringify(f.error), 120)}` : 'ok'}`)
    continue
  }
  if (f.type === 'request') {
    console.log(`${ts} IN  request ${f.method} ${f.id}`)
    continue
  }
  const n = f.params?.notification ?? f.params ?? {}
  if (skip.has(n.type)) continue
  let d = ''
  if (n.type === 'tool_call') d = `tool=${n.toolName} id=${clip(n.toolUseId, 12)} input=${clip(JSON.stringify(n.input ?? n.parameters ?? n.toolInput ?? {}), 80)} keys=${Object.keys(n).join(',')}`
  else if (n.type === 'tool_result') d = `id=${clip(n.toolUseId, 12)} result=${clip(JSON.stringify(n.content ?? n.result ?? n.value ?? ''), 70)}`
  else if (n.type === 'create_message') d = `role=${n.message?.role} vis=${n.message?.visibility ?? '-'} reqId=${clip(n.requestId, 10) ?? '-'} text=${clip(JSON.stringify(n.message?.content), 110)}`
  else if (n.type === 'droid_working_state_changed') d = n.newState
  else if (n.type === 'agent_turn_completed') d = `reason=${n.reason} turnId=${clip(n.turnId, 10)}`
  else if (n.type === 'tool_progress_update') d = `tool=${n.toolName} upd=${clip(JSON.stringify(n.update), 70)}`
  else if (n.type === 'queued_messages_discarded') d = clip(JSON.stringify(n), 120)
  else if (n.type === 'assistant_text_complete') d = clip(JSON.stringify(n.text ?? n.message ?? n), 100)
  else d = clip(JSON.stringify(n), 120)
  console.log(`${ts} IN  ${n.type ?? f.method} ${d}`)
}
