// Finds home paths and personal metadata in a recorded provider frame, however it is encoded.

export const privateText =
  /\/Users\/|\/home\/|[a-z]:[\\/]+Users[\\/]|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\bhostname\b|\b[\w-]+\.(?:local|lan)\b|signature|subscription_tier|skills?/i

export function decodedStrings(value: unknown, depth = 0): string[] {
  if (depth > 8) {
    return []
  }
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every(
        (entry) =>
          typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 255
      )
    ) {
      return decodedStrings(Buffer.from(value).toString('utf8'), depth + 1)
    }
    return value.flatMap((entry) => decodedStrings(entry, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) => [
      key,
      ...decodedStrings(entry, depth + 1)
    ])
  }
  if (typeof value !== 'string') {
    return []
  }
  const texts = [value]
  try {
    const decoded = decodeURIComponent(value)
    if (decoded !== value) {
      texts.push(...decodedStrings(decoded, depth + 1))
    }
  } catch {
    /* Provider text need not be URI encoded. */
  }
  try {
    const decoded: unknown = JSON.parse(value)
    if (decoded !== value) {
      texts.push(...decodedStrings(decoded, depth + 1))
    }
  } catch {
    /* Ordinary text is not JSON. */
  }
  for (const token of value.match(/[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []) {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    if (
      decoded !== token &&
      !decoded.includes('\uFFFD') &&
      [...decoded].every(
        (char) =>
          ['\n', '\r', '\t'].includes(char) ||
          (char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
      )
    ) {
      texts.push(...decodedStrings(decoded, depth + 1))
    }
  }
  return texts
}
