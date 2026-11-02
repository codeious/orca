const DROID_SESSION_ID = /^[A-Za-z0-9_-]+$/

/** A session link or free text names no session, and a client-supplied id must not be able to name a path. */
export function isDroidSessionId(value: string): boolean {
  return DROID_SESSION_ID.test(value)
}
