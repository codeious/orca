/** What Droid 1.0.0 answered `droid.get_context_breakdown` with on a new session (no skills, servers or droids). */
export const DROID_CONTEXT_BREAKDOWN = {
  modelId: 'claude-haiku-5-5',
  modelDisplayName: 'Haiku 5.5',
  contextBudget: 250000,
  usedTokens: 10501,
  freeTokens: 239499,
  categories: [
    { name: 'System prompt', tokens: 1558, colorKey: 'systemPrompt' },
    { name: 'System tools', tokens: 8862, colorKey: 'systemTools' },
    { name: 'MCP tools', tokens: 0, colorKey: 'mcpTools' },
    { name: 'User info', tokens: 0, colorKey: 'userInfo' },
    { name: 'AGENTS.md', tokens: 0, colorKey: 'agentsMd' },
    { name: 'Custom agents', tokens: 81, colorKey: 'customAgents' },
    { name: 'Skills', tokens: 0, colorKey: 'skills' },
    { name: 'Messages', tokens: 0, colorKey: 'messages' }
  ],
  skills: [],
  mcpServers: [],
  droids: []
}

const NO_CREDITS = {
  inputTokens: 371,
  outputTokens: 124,
  cacheCreationTokens: 3691,
  cacheReadTokens: 32297,
  thinkingTokens: 0
}

/** A `session_token_usage_changed` notification as captured on 0.251.0 (`compact-rewind-mcp-auth`
 *  frame 30): the session id sits inside the notification, and credits ride on the two totals only. */
export function droidTokenUsageChanged(credits: {
  tokenUsage?: number
  inclusiveTokenUsage?: number
  lastCallTokenUsage?: number
}): Record<string, unknown> {
  const total = (factoryCredits: number | undefined) =>
    factoryCredits === undefined ? NO_CREDITS : { ...NO_CREDITS, factoryCredits }
  return {
    type: 'session_token_usage_changed',
    sessionId: 'droid-session-1',
    tokenUsage: total(credits.tokenUsage),
    inclusiveTokenUsage: total(credits.inclusiveTokenUsage),
    lastCallTokenUsage: {
      inputTokens: 168,
      outputTokens: 3,
      cacheReadTokens: 17911,
      ...(credits.lastCallTokenUsage === undefined
        ? {}
        : { factoryCredits: credits.lastCallTokenUsage })
    }
  }
}
