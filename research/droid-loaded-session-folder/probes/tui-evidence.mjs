// usage: tui-evidence.mjs snapshot <out.json> | diff <before.json>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR } from './lib.mjs'
import { evidence, mask } from './paid-lib.mjs'

const root = join(HOME_DIR, '.factory', 'sessions')
function listing() {
  const out = {}
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    for (const f of readdirSync(join(root, d.name)).filter((n) => n.endsWith('.jsonl'))) {
      const p = join(root, d.name, f)
      out[p] = readFileSync(p, 'utf8').split('\n').filter(Boolean).length
    }
  }
  return out
}
const [mode, arg] = process.argv.slice(2)
if (mode === 'snapshot') writeFileSync(arg, JSON.stringify(listing()))
else {
  const before = JSON.parse(readFileSync(arg, 'utf8'))
  for (const [p, n] of Object.entries(listing())) {
    if ((before[p] ?? 0) === n) continue
    const first = JSON.parse(readFileSync(p, 'utf8').split('\n')[0])
    const slug = p.split('/').slice(-2)[0].replace('-private-tmp-droid-28-', '')
    console.log(`${before[p] === undefined ? 'NEW' : 'GREW'} file: slug ${slug} | id ${mask(first.id).slice(0, 8)} | parent ${first.parent ? mask(first.parent).slice(0, 8) : '-'} | session_start.cwd ${first.cwd?.replace('/tmp/droid-28/', '')} | records ${before[p] ?? 0} -> ${n}`)
    console.log(evidence(p, before[p] ?? 0).text)
  }
}
