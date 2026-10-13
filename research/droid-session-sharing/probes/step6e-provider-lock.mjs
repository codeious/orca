// Credit-free (invalid key): can a structured process change the model of a session a real turn already locked to a provider?
import { PROJ_DIR, cleanEnv, startDroid } from './lib.mjs'
const X = process.argv[2]
const B = startDroid({ tag: 'step6e', env: cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' }) })
const load = await B.request('droid.load_session', { sessionId: X })
const models = load.result?.availableModels ?? []
const cur = load.result?.settings?.modelId
const provider = (m) => m.modelProvider ?? m.provider ?? m.apiProvider ?? '(no provider field)'
console.log('loaded; current model', cur, '| model row keys:', Object.keys(models[0] ?? {}).join(','))
const other = models.find((m) => !m.isCustom && m.id !== cur && /claude/i.test(m.id))
const same = models.find((m) => !m.isCustom && m.id !== cur && /gpt/i.test(m.id))
for (const [label, m] of [['same family', same], ['other family', other]]) {
  if (!m) { console.log(label, ': no candidate'); continue }
  const res = await B.request('droid.update_session_settings', { modelId: m.id })
  console.log(`${label} (${m.id}, provider ${provider(m)}):`, res.error ? `error ${JSON.stringify(res.error).slice(0, 260)}` : `ok, settings.modelId now ${res.result?.settings?.modelId ?? '(not echoed)'}`)
}
await B.close()
