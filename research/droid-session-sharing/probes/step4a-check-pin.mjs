// Credit-free (invalid key): does the --settings overlay change the model a new session starts with?
import { PROJ_DIR, cleanEnv, startDroid, maskIds } from './lib.mjs'

const BAD = cleanEnv({ FACTORY_API_KEY: 'fk-invalid-orca-probe-23' })
const d = startDroid({
  tag: 'step4a',
  env: BAD,
  args: ['exec', '--settings', '/tmp/droid-23/tui-settings.json', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc']
})
const init = await d.request('droid.initialize_session', { machineId: 'probe-machine', cwd: PROJ_DIR, interactionMode: 'auto', autonomyLevel: 'off' })
const s = init.result?.settings ?? {}
console.log('error:', init.error ? JSON.stringify(init.error).slice(0, 200) : 'none')
console.log('settings:', JSON.stringify({ modelId: s.modelId, reasoningEffort: s.reasoningEffort }))
await d.close()
console.log('stderr:', maskIds(d.stderr.join('')).slice(0, 200))
