import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DROID_CHILD_COMMAND_NAMES,
  DROID_HOST_COMMAND_NAMES
} from '../../../../shared/droid-command-registry'
import { droidCommandSuggestions } from './droid-commands'

const EN_CATALOG_PATH = join(__dirname, '../../i18n/locales/en.json')

function enCommandWords(): Record<string, unknown> {
  const catalog = JSON.parse(readFileSync(EN_CATALOG_PATH, 'utf8'))
  return catalog.components['native-chat'].droidCommands
}

describe('the Droid command registry in the slash menu', () => {
  it('offers one row for each registered command, in registry order, each with a description', () => {
    const rows = droidCommandSuggestions()
    expect(rows.map((row) => row.name)).toEqual([...DROID_HOST_COMMAND_NAMES])
    for (const row of rows) {
      expect(row.description?.trim()).toBeTruthy()
    }
  })

  it('offers /help', () => {
    expect(droidCommandSuggestions().map((row) => row.name)).toContain('help')
  })

  // A child command acts on its first submit; only the session commands ask a second time.
  it('registers /fork, /rename, /cwd, /cd, /skills, /mcp and /rewind-conversation as child commands, after /compress', () => {
    expect(DROID_CHILD_COMMAND_NAMES).toEqual([
      'context',
      'cost',
      'compress',
      'fork',
      'rename',
      'cwd',
      'cd',
      'skills',
      'mcp',
      'rewind-conversation'
    ])
    expect(DROID_HOST_COMMAND_NAMES).toEqual(
      expect.arrayContaining([
        'fork',
        'rename',
        'cwd',
        'cd',
        'skills',
        'mcp',
        'rewind-conversation'
      ])
    )
  })

  it('keeps the words of every registered command in en.json, and nothing else', () => {
    expect(Object.keys(enCommandWords()).sort()).toEqual([...DROID_HOST_COMMAND_NAMES].sort())
  })
})
