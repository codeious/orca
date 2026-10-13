// Prints record shapes (types, keys, block kinds, text lengths) for a Droid session transcript, never the text.
import { readFileSync } from 'node:fs'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
for (const file of process.argv.slice(2)) {
  console.log(`== ${file.replace(UUID, (m) => m.slice(0, 4))}`)
  readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((line, i) => {
    const r = JSON.parse(line)
    const m = r.message
    const blocks = m?.content?.map((c) => `${c.type}${typeof c.text === 'string' ? `(${c.text.length})` : ''}`).join(',')
    const extra = ['seq', 'visibility', 'parentId', 'userMessageSource', 'reason', 'parent', 'forkedAtMessageId', 'sessionTitleAutoStage']
      .filter((k) => k in r || (m && k in m)).map((k) => `${k}=${String(r[k] ?? m?.[k]).slice(0, 8)}`).join(' ')
    console.log(`${i} ${r.type} keys=[${Object.keys(r).join(',')}] ${m ? `role=${m.role} blocks=[${blocks}] mkeys=[${Object.keys(m).join(',')}]` : ''} ${extra}`)
  })
}
