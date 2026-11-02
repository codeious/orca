import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { droidSettingsMayPickModel } from '../native-chat/agent-model-catalog/agent-project-model-config-keys'
import { workspaceMayOverrideDefaultModel } from '../native-chat/agent-model-catalog/agent-project-model-override'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Droid project model overrides', () => {
  it.each([
    ['{"model":"custom:local"}', true],
    ['{"reasoningEffort":"high"}', true],
    ['{"sessionDefaultSettings":{"model":"custom:local"}}', true],
    ['{"sessionDefaultSettings":{"reasoningEffort":"high"}}', true],
    ['{"sessionDefaultSettings":null}', true],
    ['{', true],
    ['{"hooks":{},"autonomyLevel":"high"}', false],
    ['{"sessionDefaultSettings":{"autonomyLevel":"off"}}', false]
  ])('checks model-affecting settings in %s', (settings, expected) => {
    expect(droidSettingsMayPickModel(settings)).toBe(expected)
  })

  it('reads repository ancestors but only the chat folder in a folder workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-droid-project-'))
    roots.push(root)
    const repo = join(root, 'repo')
    const chat = join(repo, 'packages', 'chat')
    mkdirSync(chat, { recursive: true })
    mkdirSync(join(repo, '.factory'))
    writeFileSync(join(repo, '.factory', 'settings.local.json'), '{"model":"custom:local"}')
    const read = () =>
      workspaceMayOverrideDefaultModel({
        agent: 'droid',
        workspacePath: chat,
        accountHomePath: join(root, '.factory')
      })
    expect(await read()).toBe(false)
    writeFileSync(join(repo, '.git'), 'gitdir: /elsewhere')
    expect(await read()).toBe(true)
    expect(
      await workspaceMayOverrideDefaultModel({
        agent: 'droid',
        workspacePath: repo,
        accountHomePath: join(repo, '.factory')
      })
    ).toBe(false)
  })
})
