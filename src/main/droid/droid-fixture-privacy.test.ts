import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { decodedStrings, privateText } from '../native-chat/provider-recording-privacy.test-support'

const NIL_BOOT_ID = '00000000-0000-0000-0000-000000000000'

// Why three folders: Droid recordings sit beside the code that replays them, not in one place.
const FIXTURE_FOLDERS = [
  { directory: new URL('./fixtures/', import.meta.url), accepts: () => true },
  { directory: new URL('./__fixtures__/', import.meta.url), accepts: () => true },
  {
    directory: new URL('../../shared/__fixtures__/', import.meta.url),
    accepts: (name: string) => name.startsWith('droid-')
  }
]

/** Every line of a `.jsonl` recording, or the whole document of a `.meta.json` one. */
async function recordedDocuments(): Promise<{ label: string; text: string }[]> {
  const documents: { label: string; text: string }[] = []
  for (const { directory, accepts } of FIXTURE_FOLDERS) {
    const names = (await readdir(directory)).filter(
      (name) => accepts(name) && (name.endsWith('.jsonl') || name.endsWith('.meta.json'))
    )
    for (const name of names) {
      const content = await readFile(new URL(name, directory), 'utf8')
      const parts = name.endsWith('.jsonl') ? content.trim().split('\n') : [content]
      for (const [index, text] of parts.entries()) {
        documents.push({
          label: `${directory.pathname.split('/').slice(-3).join('/')}${name}:${index + 1}`,
          text
        })
      }
    }
  }
  return documents
}

describe('Droid recording privacy', () => {
  it('contains no personal metadata or home-directory paths in any decoded fixture', async () => {
    const documents = await recordedDocuments()
    expect(documents.length).toBeGreaterThan(0)
    for (const { label, text } of documents) {
      // Thinking blocks keep `"signature":"<elided>"` and `"signatureProvider":"openai"`; those key names are not private.
      const recorded: unknown = JSON.parse(text, (key, value) =>
        key === 'signatureProvider' || value === '<elided>' ? undefined : value
      )
      expect(
        decodedStrings(recorded).some((value) => privateText.test(value)),
        label
      ).toBe(false)
    }
  })

  it('names no machine or kernel boot identifier', async () => {
    for (const { label, text } of await recordedDocuments()) {
      for (const [, machineId] of text.matchAll(/machineId\\*":\\*"([^"\\]*)/g)) {
        expect(machineId, label).toBe('<machine-id>')
      }
      // A Linux process start time is `<boot id>:<ticks>`, which names the machine it ran on.
      for (const [, bootId] of text.matchAll(
        /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):\d+/g
      )) {
        expect(bootId, label).toBe(NIL_BOOT_ID)
      }
    }
  })
})
