import { z } from 'zod'
import {
  MAX_CONTEXT_CATEGORIES,
  MAX_CONTEXT_CATEGORY_NAME_CHARS,
  MAX_CONTEXT_MODEL_ID_CHARS,
  type AgentSessionContextReport
} from '../../shared/agent-session-context-usage'
import { errorMessage } from '../../shared/error-message'
import type { ProviderTimelineEvent } from '../native-chat/agent-session-timeline/provider-timeline-event'

const breakdownSchema = z.looseObject({
  modelId: z.string().min(1),
  contextBudget: z.number().positive(),
  usedTokens: z.number().nonnegative(),
  categories: z
    .array(z.looseObject({ name: z.string(), tokens: z.number().nonnegative() }))
    .default([])
})

const creditsSchema = z.looseObject({ factoryCredits: z.number().nonnegative().optional() })
const tokenUsageChangedSchema = z.looseObject({
  type: z.literal('session_token_usage_changed'),
  tokenUsage: creditsSchema.optional(),
  inclusiveTokenUsage: creditsSchema.optional()
})
const envelopeSchema = z.looseObject({ notification: z.unknown() })

/** Droid's `droid.get_context_breakdown` answer as the ring's report; absent when it is unreadable. */
function droidContextReport(result: unknown, at: number): AgentSessionContextReport | undefined {
  const parsed = breakdownSchema.safeParse(result)
  if (!parsed.success) {
    return undefined
  }
  const { modelId, contextBudget, usedTokens, categories } = parsed.data
  return {
    model: modelId.slice(0, MAX_CONTEXT_MODEL_ID_CHARS),
    usedTokens,
    windowTokens: contextBudget,
    percentage: Math.round((usedTokens / contextBudget) * 100),
    // The journal refuses a report holding a nameless category, which would drop the whole ring.
    categories: categories
      .filter(({ name }) => name.length > 0)
      .slice(0, MAX_CONTEXT_CATEGORIES)
      .map(({ name, tokens }) => ({
        name: name.slice(0, MAX_CONTEXT_CATEGORY_NAME_CHARS),
        tokens
      })),
    capturedAt: at
  }
}

type DroidContextUsageDeps = {
  request: (method: string, params: unknown) => Promise<unknown>
  apply: (events: ProviderTimelineEvent[]) => void
  warn: (message: string, fields: { error: string }) => void
}

/** What Droid says about the session's context and spend; the ring and `/context` share one breakdown. */
export class DroidContextUsage {
  private factoryCredits: number | undefined

  constructor(private readonly deps: DroidContextUsageDeps) {}

  get credits(): number | undefined {
    return this.factoryCredits
  }

  /** `droid.session_notification` params. Credits come from the two totals, never `lastCallTokenUsage`;
   *  the inclusive one also counts subagents. */
  receive(params: unknown): void {
    const envelope = envelopeSchema.safeParse(params)
    const usage = tokenUsageChangedSchema.safeParse(envelope.data?.notification)
    if (!usage.success) {
      return
    }
    const { inclusiveTokenUsage, tokenUsage } = usage.data
    this.factoryCredits =
      inclusiveTokenUsage?.factoryCredits ?? tokenUsage?.factoryCredits ?? this.factoryCredits
  }

  /** Reads the breakdown and gives it to the ring. Throws when Droid cannot answer. */
  async refresh(): Promise<AgentSessionContextReport | undefined> {
    const report = droidContextReport(
      await this.deps.request('droid.get_context_breakdown', {}),
      Date.now()
    )
    if (report) {
      this.deps.apply([{ type: 'context.usage', usage: { used: { kind: 'report', ...report } } }])
    }
    return report
  }

  /** Follows what just changed the context (a turn ended, a compaction); a Droid that cannot answer leaves the ring as it was. */
  refreshInBackground(): void {
    void this.refresh().catch((error: unknown) =>
      this.deps.warn('Droid did not report its context', { error: errorMessage(error) })
    )
  }
}
