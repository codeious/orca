/** Agents whose composer retains Orca's default keys. */

const NON_DROID_NATIVE_AGENTS = ['claude', 'openclaude', 'codex', 'pi'] as const

export const NON_DROID_ACP_AGENTS = ['antigravity', 'grok', 'opencode', 'opencode2', 'omp'] as const

export const NON_DROID_AGENTS = [...NON_DROID_NATIVE_AGENTS, ...NON_DROID_ACP_AGENTS] as const
