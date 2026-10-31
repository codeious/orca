import {
  resolveProviderChildEnv,
  type ProviderProcessLaunch
} from '../provider-process/provider-process-launch'
import { resolveDroidAccountHome } from './droid-account-home'
import { findDroidSessionFile, readDroidSessionCompaction } from './droid-session-file'

export type DroidCompactionSummary = { id: string; text: string }
export type DroidCompactionSummaryReader = (
  launch: ProviderProcessLaunch,
  sessionId: string
) => Promise<DroidCompactionSummary | null>

export const readDroidCompactionSummary: DroidCompactionSummaryReader = async (
  launch,
  sessionId
) => {
  const account = resolveDroidAccountHome({
    launchEnv: resolveProviderChildEnv(launch, process.env)
  })
  const file = await findDroidSessionFile(account.path, sessionId)
  return file ? readDroidSessionCompaction(file) : null
}

/** File writes can trail the compact response; a slow or older host must not hold the chat. */
export async function boundedDroidSummaryRead(
  read: () => Promise<DroidCompactionSummary | null>,
  timeoutMs = 200
): Promise<DroidCompactionSummary | null | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read().catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForDroidCompactionSummary(
  read: () => Promise<DroidCompactionSummary | null>,
  previous: DroidCompactionSummary | null | undefined
): Promise<string | null> {
  // A timed-out baseline cannot distinguish this compact from an older summary.
  if (previous === undefined) {
    return null
  }
  const deadline = Date.now() + 1_000
  do {
    const summary = await boundedDroidSummaryRead(read, Math.max(1, deadline - Date.now()))
    if (summary && summary.id !== previous?.id) {
      return summary.text
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)))
  } while (Date.now() < deadline)
  return null
}
