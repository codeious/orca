import { NON_DROID_AGENTS } from '../../../../shared/non-droid-composer-key-agents.test-fixture'

export const KEY_PLATFORMS = [
  { os: 'macOS', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', mac: true },
  { os: 'Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', mac: false },
  { os: 'Linux', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', mac: false }
] as const

export const NON_DROID_AGENTS_BY_PLATFORM = NON_DROID_AGENTS.flatMap((agent) =>
  KEY_PLATFORMS.map((platform) => ({ agent, ...platform }))
)
