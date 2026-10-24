// Turns pty-timing-drive.py output into harness fixtures: <name>.txt plus <name>.timing.json of
// [ms since spawn, UTF-16 length] reads, with the repo scanner's same-length redaction applied.
// usage: node build-replay-fixtures.mjs <timing-run-dir>... --out <dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  redactTranscript,
  scanTranscriptForSecrets
} from '../../config/scripts/pty-transcript-secret-scan.mjs'

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const outDir = args[outAt + 1]
const runDirs = args.filter((_, index) => index !== outAt && index !== outAt + 1)
mkdirSync(outDir, { recursive: true })

for (const dir of runDirs) {
  // timing-0.249.0-badkey-bare-120x40 -> droid-0-249-0-signed-out-badkey-bare-120x40
  const [, version, ...rest] = basename(dir).split('-')
  const name = `droid-${version.replaceAll('.', '-')}-signed-out-${rest.join('-')}`
  const raw = readFileSync(join(dir, 'run.raw'))
  const rows = readFileSync(join(dir, 'run.timing.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const decoder = new StringDecoder('utf8')
  let text = ''
  const chunks = []
  for (const row of rows.filter((entry) => entry.n !== undefined)) {
    const piece = decoder.write(raw.subarray(row.off, row.off + row.n))
    chunks.push([row.t, piece.length])
    text += piece
  }
  const tail = decoder.end()
  if (tail.length > 0) {
    chunks.push([chunks.at(-1)[0], tail.length])
    text += tail
  }
  const redacted = redactTranscript(text)
  if (scanTranscriptForSecrets(redacted.text).length > 0) {
    throw new Error(`${name} still has scanner findings`)
  }
  const end = JSON.parse(readFileSync(join(dir, 'run.end.json'), 'utf8'))
  const sent = rows.find((entry) => entry.sent !== undefined)
  writeFileSync(join(outDir, `${name}.txt`), redacted.text)
  writeFileSync(
    join(outDir, `${name}.timing.json`),
    `${JSON.stringify({ chunks, promptSentAtMs: sent?.t, recordedUntilMs: end.duration_ms })}\n`
  )
  console.log(`${name}: ${chunks.length} reads, ${redacted.text.length} chars, ${redacted.redacted} redacted`)
}
