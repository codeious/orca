/** Opt-in for tests that start the real `droid` CLI on this machine. */
export const REAL_DROID_CLI_TEST_ENV = 'ORCA_REAL_DROID_CLI_TEST'

export type RealDroidCliGate = {
  /** Null when the real-CLI suite may run; otherwise why it is skipped. */
  skipReason: string | null
}

export function resolveRealDroidCliGate(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  runDroid: (args: readonly string[]) => { status: number | null }
): RealDroidCliGate {
  // Why before any probe: an installed CLI is not consent to start it from a broad local test run.
  if (env[REAL_DROID_CLI_TEST_ENV] !== '1') {
    return { skipReason: `set ${REAL_DROID_CLI_TEST_ENV}=1 to run against the real droid CLI` }
  }
  if (platform === 'win32') {
    return { skipReason: 'the real-CLI suite drives the POSIX hook script' }
  }
  if (runDroid(['--version']).status !== 0) {
    return { skipReason: '`droid --version` failed' }
  }
  return { skipReason: null }
}
