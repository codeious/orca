// Lists session files not in a baseline list and reports how each links to its parent. Usage: node fork-report.mjs <baseline-file> <original-id>
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const [baseline, orig] = process.argv.slice(2)
const dir = '/tmp/droid-23/home/.factory/sessions/-private-tmp-droid-23-proj'
const before = new Set(readFileSync(baseline, 'utf8').split('\n').filter(Boolean))
const s4 = (x) => (x ? `<${String(x).slice(0, 4)}>` : '-')
for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsonl') && !before.has(n))) {
  const recs = readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const start = recs[0]
  const msgs = recs.filter((r) => r.type === 'message')
  console.log(`new session ${s4(name)}: id==file ${start.id === name.replace('.jsonl', '')}, parent ${s4(start.parent)} (original is ${s4(orig)}), forkedAtMessageId ${s4(start.forkedAtMessageId)}, title ${JSON.stringify(start.title)}`)
  console.log(`  records ${recs.length}, message seqs [${msgs.map((m) => m.seq).join(',')}], session_start keys: ${Object.keys(start).join(',')}`)
  console.log(`  userMessageSource values: ${[...new Set(msgs.map((m) => m.message.userMessageSource ?? '(none)'))].join(', ')}`)
  console.log(`  forked messages keep original ids: ${msgs.slice(0, 3).map((m) => s4(m.id)).join(' ')}`)
}
