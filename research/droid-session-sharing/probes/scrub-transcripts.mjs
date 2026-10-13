// Turns the probe's raw Droid session files into shape-only fixtures.
// Keeps record kinds, field names, ordering, seq/parentId links and short user-visible strings.
// Elides the hidden context/tool-catalog text, compaction summaries, host and owner identity,
// provider message ids, and the temp working directory. Ids are renumbered consistently across files.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const SRC = '/tmp/droid-23/home/.factory/sessions/-private-tmp-droid-23-proj'
const OUT = new URL('../fixtures/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

// prefix of the real session id -> fixture name
const FILES = [
  ['fc3c', 'structured-session'],
  ['c626', 'terminal-session'],
  ['727b', 'terminal-session-fork'],
  ['fd06', 'structured-session-fork'],
  ['2c2e', 'empty-terminal-session']
]
// Interactive `droid --fork` copy of structured-session: same records as structured-session, not kept.
const NAMED_ONLY = [['0d20', 'structured-session-tui-fork']]
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const names = readdirSync(SRC)
const fileFor = (prefix, suffix = '.jsonl') =>
  names.find((n) => n.startsWith(prefix) && n.endsWith(suffix))

const sessionNames = new Map()
for (const [prefix, name] of [...FILES, ...NAMED_ONLY]) {
  sessionNames.set(fileFor(prefix).replace(/\.jsonl$/, ''), `<${name}>`)
}

const ids = new Map()
const renumber = (uuid) => {
  if (sessionNames.has(uuid)) return sessionNames.get(uuid)
  if (!ids.has(uuid)) ids.set(uuid, `<id-${String(ids.size + 1).padStart(2, '0')}>`)
  return ids.get(uuid)
}
const maskText = (s) =>
  s.replace(UUID, renumber).replace(/(\/private)?\/tmp\/droid-23\/proj/g, '$1/tmp/<probe-cwd>')
const elided = (s) => `<elided: ${String(s).length} chars>`

function scrubRecord(r) {
  if (r.type === 'session_start') {
    return { ...r, owner: '<owner>', hostId: '<host-id>' }
  }
  if (r.type === 'message') {
    const m = { ...r.message }
    const hidden = m.visibility === 'llm_only' || (m.role === 'user' && m.content.length > 3)
    m.content = m.content.map((b) =>
      b.type === 'text' && hidden ? { ...b, text: elided(b.text) } : b
    )
    if (m.openaiMessageId) m.openaiMessageId = '<openai-message-id>'
    return { ...r, message: m }
  }
  if (r.type === 'compaction_state') {
    return {
      ...r,
      summaryText: elided(r.summaryText),
      systemInfoText: elided(r.systemInfoText),
      systemInfo: { elided: Object.keys(r.systemInfo ?? {}) }
    }
  }
  return r
}

for (const [prefix, name] of FILES) {
  const lines = readFileSync(`${SRC}/${fileFor(prefix)}`, 'utf8').split('\n').filter(Boolean)
  const out = lines.map((l) => maskText(JSON.stringify(scrubRecord(JSON.parse(l))))).join('\n')
  writeFileSync(`${OUT}${name}.jsonl`, `${out}\n`)
}

const settingsFile = fileFor('c626', '.settings.json')
writeFileSync(`${OUT}terminal-session.settings.json`, maskText(readFileSync(`${SRC}/${settingsFile}`, 'utf8')))
console.log(`wrote ${FILES.length} transcripts and 1 settings file; ${ids.size} ids renumbered`)
