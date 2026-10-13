// Runs Orca's own Droid vault parser over every transcript in the throwaway HOME.
// Run with bun, with ORCA_REPO pointing at an Orca checkout.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const { parseDroidSessionFile } = await import(
  `${process.env.ORCA_REPO}/src/main/ai-vault/session-scanner-droid-parser`
)

const root = '/tmp/droid-23/home/.factory/sessions'
const short = (s: unknown) => (typeof s === 'string' ? s.slice(0, 4) : String(s))
for (const folder of readdirSync(root)) {
  const dir = join(root, folder)
  if (!statSync(dir).isDirectory()) continue
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    const path = join(dir, name)
    const session = await parseDroidSessionFile({ path, mtimeMs: statSync(path).mtimeMs } as never)
    console.log(`file ${short(name)}…jsonl in ${folder}`)
    console.log(
      JSON.stringify(
        {
          agent: session?.agent,
          sessionIdMatchesFileName: session?.sessionId === name.replace('.jsonl', ''),
          title: session?.title,
          cwd: session?.cwd,
          messageCount: session?.messageCount,
          previews: session?.previewMessages?.map((m) => `${m.role}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 50)}`)
        },
        null,
        2
      )
    )
  }
}
