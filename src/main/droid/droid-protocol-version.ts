export function isSupportedDroidProtocol(version: string): boolean {
  return /^1\.\d+\.\d+$/.test(version)
}
