import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { decodedStrings, privateText } from '../native-chat/provider-recording-privacy.test-support'

describe('ACP recording privacy', () => {
  it.each([
    '/Users/u',
    '/home/u',
    '/home/é',
    '/Users/private/project',
    '/home/private/project',
    'C:\\Users\\private\\project'
  ])('detects home paths after nested JSON, URL, base64 and byte encoding: %s', (path) => {
    for (const value of [
      path,
      encodeURIComponent(path),
      Buffer.from(path).toString('base64'),
      [...Buffer.from(path)],
      JSON.stringify({ nested: JSON.stringify(path) })
    ]) {
      expect(decodedStrings(value).some((text) => privateText.test(text))).toBe(true)
    }
  })

  it('contains no personal metadata or home-directory paths in any decoded fixture', async () => {
    const directory = new URL('./fixtures/', import.meta.url)
    const names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl'))
    expect(names.length).toBeGreaterThanOrEqual(6)
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
