import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { decodedStrings, privateText } from '../native-chat/provider-recording-privacy.test-support'

describe('Droid recording privacy', () => {
  it('contains no personal metadata or home-directory paths in any decoded fixture', async () => {
    const directory = new URL('./fixtures/', import.meta.url)
    const names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl'))
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const content = await readFile(new URL(name, directory), 'utf8')
      for (const [index, line] of content.trim().split('\n').entries()) {
        const value: unknown = JSON.parse(line)
        expect(
          decodedStrings(value).some((text) => privateText.test(text)),
          `${name}:${index + 1}`
        ).toBe(false)
      }
    }
  })
})
