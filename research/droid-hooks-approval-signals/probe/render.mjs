// Usage: node render.mjs <transcript> [cols] [rows] — prints the final screen of a raw PTY transcript.
import { readFileSync } from 'node:fs'
import xterm from '@xterm/headless'
const [file, cols = '120', rows = '40'] = process.argv.slice(2)
const term = new xterm.Terminal({ cols: Number(cols), rows: Number(rows), allowProposedApi: true, scrollback: 0 })
await new Promise((done) => term.write(readFileSync(file), done))
const buf = term.buffer.active
const lines = []
for (let y = 0; y < Number(rows); y++) lines.push((buf.getLine(y)?.translateToString(true) ?? '').trimEnd())
while (lines.length && lines.at(-1) === '') lines.pop()
console.log(lines.join('\n'))
