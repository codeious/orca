/** The URL when it is an http(s) link that is safe to hand to the OS browser; null for anything else. */
export function parseExternalHttpUrl(rawUrl: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
}
