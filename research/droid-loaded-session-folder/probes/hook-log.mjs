// Logs only event name, payload cwd, and the hook process's own cwd. Never the payload body.
import { readFileSync, appendFileSync } from 'node:fs'
let p = {}
try { p = JSON.parse(readFileSync(0, 'utf8')) } catch {}
appendFileSync('/tmp/droid-28/out/hooks.log', `${JSON.stringify({
  tag: process.env.PROBE_TAG ?? '',
  event: p.hook_event_name,
  session: String(p.session_id ?? '').slice(0, 8),
  payloadCwd: p.cwd,
  hookProcessCwd: process.cwd(),
  tool: p.tool_name,
  command: p.tool_input?.command
})}\n`)
