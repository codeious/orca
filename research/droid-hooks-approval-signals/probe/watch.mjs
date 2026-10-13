// Usage: node watch.mjs <seconds> <out.jsonl> — logs the shape (key names, hook script basenames) of settings.json and hooks.json on every change.
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs'
import { basename } from 'node:path'
const [secs, out] = [Number(process.argv[2]), process.argv[3]]
const dir = '/tmp/droid-hooks-probe/home/.factory/'
const start = Date.now()
const cmdName = (c) => basename(String(c ?? '').split(' ')[0].replace(/^"|"$/g, ''))
function eventsOf(map) {
  const o = {}
  for (const [ev, defs] of Object.entries(map ?? {})) {
    o[ev] = Array.isArray(defs) ? defs.flatMap((d) => (d.hooks ?? []).map((h) => cmdName(h.command))) : `<${typeof defs}>`
  }
  return o
}
function shape(name) {
  const p = dir + name
  if (!existsSync(p)) return null
  let j
  try { j = JSON.parse(readFileSync(p, 'utf8')) } catch { return { unparseable: true } }
  const s = { topKeys: Object.keys(j).sort() }
  if (name === 'settings.json') { if ('hooks' in j) s.hooks = typeof j.hooks === 'object' && j.hooks ? eventsOf(j.hooks) : j.hooks; if ('hooksDisabled' in j) s.hooksDisabled = j.hooksDisabled }
  else {
    const m = j.hooks && typeof j.hooks === 'object' ? j.hooks : j
    s.hooks = eventsOf(Object.fromEntries(Object.entries(m).filter(([, v]) => Array.isArray(v))))
    for (const [k, v] of Object.entries(m)) if (!Array.isArray(v)) s[`nonEventKey:${k}`] = typeof v === 'object' ? '<object>' : v
  }
  return s
}
let last = ''
const tick = () => {
  const cur = JSON.stringify({ settings: shape('settings.json'), hooksJson: shape('hooks.json') })
  if (cur !== last) { last = cur; appendFileSync(out, JSON.stringify({ ms: Date.now() - start, ...JSON.parse(cur) }) + '\n') }
}
const iv = setInterval(tick, 100)
setTimeout(() => { clearInterval(iv); tick() }, secs * 1000)
