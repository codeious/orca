/** Agents whose composer keeps today's keys while Droid has its own key map. Shared so the renderer
 *  key tests and the main-side pin against ACP_LAUNCH_SPECS read one list. */

const NON_DROID_NATIVE_AGENTS = ['claude', 'codex', 'pi'] as const

/** Must equal the ids in ACP_LAUNCH_SPECS; acp-launch-specs-composer-key-agents.test.ts pins it. */
export const NON_DROID_ACP_AGENTS = ['grok', 'opencode', 'omp'] as const

export const NON_DROID_AGENTS = [...NON_DROID_NATIVE_AGENTS, ...NON_DROID_ACP_AGENTS] as const
