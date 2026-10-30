// What the host knows about a structured agent before any session of it runs.
//
// Each agent's own module declares its definition, and runtime composition registers it with the
// agent's adapter in one StructuredAgentRegistry. That registry is the only lookup: the router and
// shared host code read a definition through it and never branch on the agent's name.

import type { AgentSessionCapabilities } from '../../../shared/agent-session-capabilities'
import type { AgentSessionStoredAgent } from '../../../shared/agent-session-stored-agent'
import type { AgentSessionModelOption } from '../../../shared/agent-session-wire'

/** `agent` names the Orca agent whose sessions this describes; the storage fields bound its records. */
export type StructuredAgentDefinition = AgentSessionStoredAgent & {
  capabilities: AgentSessionCapabilities
  /** How a session's options read and change while no child runs. */
  restingOptions: {
    /** Whether the agent takes a pick of this option key. */
    acceptsKey: (key: string) => boolean
    /** The models a running child falls back to with no catalog; null when it has none. */
    fallbackModels: () => AgentSessionModelOption[] | null
    /** An unpicked effort reads as the model's default effort, as a running child reports it. */
    effortDefaultsToModel: boolean
    /** Wait for a cold catalog's listing instead of answering with no models; for an agent with no
     *  fallback list, because the client keeps an empty answer as final. */
    waitsForCatalogListing?: true
    /** The at-rest answer names Spec, and the model and effort it runs on, from the saved picks:
     *  a client that sees no Spec in an answer drops the Spec row and any Spec pick it holds. */
    reportsSavedSpec?: true
    /** The autonomy level a start would send, from the saved picks and the launch arguments (absent
     *  when the host cannot read them). The answer names it so a client shows what goes out. */
    autonomyAtRest?: (
      saved: Readonly<Record<string, string>>,
      launchArgs: readonly string[] | undefined
    ) => string | undefined
  }
}

/** An agent whose account is one config directory, as Claude's and Codex's are. */
export type DirectoryAccountAgentDefinition = StructuredAgentDefinition & {
  accountHomeVariable: string
}
