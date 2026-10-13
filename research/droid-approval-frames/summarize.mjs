import { readFileSync } from 'node:fs'
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const SKIP = new Set(['mcp_status_changed', 'hook_execution_started', 'hook_execution_completed', 'assistant_text_delta', 'thinking_text_delta', 'tool_progress_update', 'session_token_usage_changed'])
let credits = 0
for (const { t, dir, frame: f } of rows) {
  if (dir === 'mark') { console.log(t, 'MARK', JSON.stringify(f).slice(0, 260)); continue }
  if (dir === 'out') { console.log(t, 'OUT', f.method || f.type, f.id || '', JSON.stringify(f.params ?? f.result ?? '').slice(0, 200)); continue }
  if (f.type === 'response') { console.log(t, 'IN  response', f.id, f.error ? 'ERROR ' + JSON.stringify(f.error).slice(0, 300) : 'ok'); continue }
  if (f.type === 'request') { console.log(t, 'IN  REQUEST', f.method, f.id, JSON.stringify(f.params).slice(0, 900)); continue }
  const n = f.params?.notification
  if (!n || SKIP.has(n.type)) continue
  if (n.type === 'agent_turn_completed') { credits += n.tokenUsage?.factoryCredits ?? 0; console.log(t, 'agent_turn_completed', n.reason, 'credits', n.tokenUsage?.factoryCredits); continue }
  if (n.type === 'settings_updated') { const s = n.settings; console.log(t, 'settings_updated reqId=' + n.requestId, JSON.stringify({ model: s.modelId, autonomy: s.autonomyLevel, mode: s.interactionMode })); continue }
  if (n.type === 'create_message') { const m = n.message; if (m.visibility === 'llm_only') continue; console.log(t, 'create_message', m.role, JSON.stringify(m.content).slice(0, 220)); continue }
  console.log(t, n.type, JSON.stringify(n).slice(0, 420))
}
console.log('TOTAL factoryCredits:', credits)
