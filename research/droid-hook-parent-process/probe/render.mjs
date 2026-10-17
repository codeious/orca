// Compact view of out/hooks.jsonl: one line per record, chains as comm(pid) from the hook script upward.
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? '/tmp/droid-31/out/hooks.jsonl'
const only = process.argv[3]
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const r = JSON.parse(line)
  if (only && !String(r.tag).startsWith(only)) continue
  if (r.kind === 'tui') {
    const kids = r.descendants.map((d) => `${d.comm}(${d.pid}<-${d.ppid})`).join(', ') || 'none'
    console.log(`[tui   ] ${r.tag} ${r.stage}: pid=${r.pid} ppid=${r.ppid} comm=${r.comm} start="${r.start}" alive=${r.alive} descendants: ${kids}`)
  } else if (r.kind === 'droid') {
    console.log(`[droid ] ${r.tag} ${r.stage}: pid=${r.pid} ppid=${r.ppid} comm=${r.comm} start="${r.start}" alive=${r.alive}`)
  } else {
    const chain = r.chain.map((c) => `${c.comm}(${c.pid})`).join(' <- ')
    const cap = r.orcaCapture ? `${r.orcaCapture.platform}:${r.orcaCapture.pid}@"${r.orcaCapture.startTime}"` : 'null'
    const extra = [r.source && `source=${r.source}`, r.reason && `reason=${r.reason}`, r.callingSession && `calling=${r.callingSession}`].filter(Boolean).join(' ')
    console.log(`[hook  ] ${r.tag} ${(r.event || '?').padEnd(16)} sid=${r.session} ${extra} capturedPPID=${r.capturedAgentPid} orcaCapture=${cap}\n           chain: ${chain}`)
  }
}
