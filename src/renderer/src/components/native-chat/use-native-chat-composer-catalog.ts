import { useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getVerifiedNativeChatCommands } from '../../../../shared/native-chat-agent-profiles'
import {
  sessionReportedSkillNames,
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../../../shared/native-chat-slash-commands'
import { structuredSlashCommands } from '../../../../shared/structured-agent-session-composer'
import { droidCommandSuggestions } from './droid-commands'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

export type NativeChatComposerCatalog = {
  agentCommands: readonly SlashCommandSuggestion[]
  sessionSkillNames: readonly string[] | undefined
}

/** A Droid chat's own commands follow whatever else it offers, which may already name one. */
function withDroidCommands(
  offered: readonly SlashCommandSuggestion[]
): readonly SlashCommandSuggestion[] {
  return [
    ...offered,
    ...droidCommandSuggestions().filter((own) => !offered.some(({ name }) => name === own.name))
  ]
}

/**
 * What the `/` menu offers. A structured session reports the surface it actually
 * loaded — the only list that includes this repo's own commands and the skills
 * that reach the session through plugin roots — so it wins whenever it is
 * present. The curated per-agent catalog remains the answer for the PTY lane and
 * for a host that predates the report.
 */
export function useNativeChatComposerCatalog(
  agent: AgentType,
  structuredTransport?: NativeChatStructuredComposerTransport
): NativeChatComposerCatalog {
  const structured = Boolean(structuredTransport)
  const reported = structuredTransport?.sessionCommands
  const conversationCommands = structuredTransport?.conversationCommands
  const agentCommands = useMemo(() => {
    if (!structured) {
      return getVerifiedNativeChatCommands(agent)
    }
    const offered =
      reported !== undefined
        ? sessionSlashCommandSuggestions(agent, reported)
        : structuredSlashCommands(conversationCommands, agent)
    return agent === 'droid' ? withDroidCommands(offered) : offered
  }, [agent, conversationCommands, reported, structured])
  const sessionSkillNames = useMemo(
    () => (reported !== undefined ? sessionReportedSkillNames(reported) : undefined),
    [reported]
  )
  return { agentCommands, sessionSkillNames }
}
