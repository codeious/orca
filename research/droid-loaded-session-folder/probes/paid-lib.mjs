// Paid-turn helpers. The key is read into child env only; never printed.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, cleanEnv, sleep } from './lib.mjs'

export const PROMPT = 'Run the shell command pwd using the shell tool and reply with only its output. Do not use any other tool.'
export const MODEL = { modelId: 'gpt-6-luna', reasoningEffort: 'none' }

export function paidEnv(tag) {
  const raw = readFileSync(process.env.KEY_FILE, 'utf8')
  const line = raw.split('\n').find((l) => /^(export )?FACTORY_API_KEY=/.test(l))
  const key = (line ? line.replace(/^(export )?FACTORY_API_KEY=/, '') : raw.split('\n')[0]).trim().replace(/^["']|["']$/g, '')
  if (!key) throw new Error('no key found')
  return cleanEnv({ FACTORY_API_KEY: key, PROBE_TAG: tag })
}

export const mask = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => m.slice(0, 8))

export function findSessionFile(id) {
  const root = join(HOME_DIR, '.factory', 'sessions')
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const f = join(root, d.name, `${id}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text ?? b.content ?? '').join('') : JSON.stringify(c))

// Tool calls, tool results, and outcomes written after `fromLine`.
export function evidence(file, fromLine = 0) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const out = []
  lines.slice(fromLine).forEach((l, i) => {
    const r = JSON.parse(l)
    if (r.type === 'agent_turn_outcome') out.push(`  outcome: ${r.reason}`)
    for (const b of r.message?.content ?? []) {
      if (b.type === 'tool_use') out.push(`  tool_use: ${b.name} ${JSON.stringify(b.input).slice(0, 160)}`)
      if (b.type === 'tool_result') out.push(`  tool_result: ${mask(text(b.content)).replace(/\s+/g, ' ').slice(0, 200)}`)
      if (b.type === 'text' && r.message.role === 'assistant') out.push(`  assistant: ${mask(b.text).slice(0, 120)}`)
    }
  })
  return { total: lines.length, text: out.join('\n') || '  (no tool or outcome records)' }
}

export async function waitForOutcome(file, startLines, ms = 120000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    await sleep(1500)
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(startLines)
    if (lines.some((l) => JSON.parse(l).type === 'agent_turn_outcome')) { await sleep(1500); return true }
  }
  return false
}

export const lineCount = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).length
