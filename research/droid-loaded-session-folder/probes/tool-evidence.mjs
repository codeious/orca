// Prints, per session file, the tool calls, tool results and outcomes in record order. Paths relativized.
import { readFileSync } from 'node:fs'
import { findSessionFile, mask } from './paid-lib.mjs'

const rel = (s) => String(s).replaceAll('/private/tmp/droid-28/', '').replaceAll('/tmp/droid-28/', '')
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text ?? b.content ?? '').join('') : JSON.stringify(c))
for (const [label, id] of process.argv.slice(2).map((a) => a.split('='))) {
  const file = findSessionFile(id)
  console.log(`# ${label} (id ${id.slice(0, 8)}, folder slug ${rel(file.split('/').slice(-2)[0]).replace('-private-tmp-droid-28-', '')})`)
  readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((l, i) => {
    const r = JSON.parse(l)
    if (r.type === 'session_start') console.log(`  [${i}] session_start cwd=${rel(r.cwd)} parent=${r.parent ? r.parent.slice(0, 8) : '-'}`)
    if (r.type === 'agent_turn_outcome') console.log(`  [${i}] outcome ${r.reason}`)
    for (const b of r.message?.content ?? []) {
      if (b.type === 'tool_use') console.log(`  [${i}] tool_use ${b.name} command=${JSON.stringify(b.input?.command)}`)
      if (b.type === 'tool_result') console.log(`  [${i}] tool_result ${rel(mask(text(b.content))).replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  })
}
