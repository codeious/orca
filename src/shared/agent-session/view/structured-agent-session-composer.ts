import { agentSessionInteractionCommand } from '../options/agent-session-interaction-mode'
import { getNativeChatAgentProfile } from '../../native-chat/native-chat-agent-profiles'
import type { AgentType } from '../../agent-status/contracts/agent-status-types'
import type { SessionOptionDescriptor } from '../../native-chat/input/native-chat-session-options'
import type { SlashCommandSuggestion } from '../../native-chat/input/native-chat-slash-commands'
import type { AgentSessionThreadGoalChange } from '../agent-session-thread-goal-wire'
import type { AgentSessionSlashCommand } from '../agent-session-wire'
import { structuredComposerFailure } from '../failures/structured-agent-session-composer-failure'

import {
  CONVERSATION_COMMANDS,
  STRUCTURED_AGENT_SESSION_SLASH_COMMANDS
} from './structured-agent-session-command-catalog'
export {
  STRUCTURED_AGENT_SESSION_SLASH_COMMANDS,
  structuredSlashCommands,
  structuredSessionSlashCommands
} from './structured-agent-session-command-catalog'
import type {
  StructuredAgentSessionComposerOptions,
  StructuredAgentSessionCommandOutcome
} from './structured-agent-session-composer-contract'
export type {
  StructuredAgentSessionComposerOptions,
  StructuredAgentSessionCommandOutcome,
  StructuredAgentSessionCommandRefusalCause
} from './structured-agent-session-composer-contract'

function commandParts(text: string): { name: string; argument: string } | null {
  if (!text.startsWith('/')) {
    return null
  }
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trimEnd())
  if (!match) {
    return null
  }
  const name = match[1]!.toLowerCase()
  const argument = match[2]?.trim() ?? ''
  // Other commands take one line; a longer message that starts with their name is for the agent.
  return /[\n\r\u2028\u2029]/.test(argument) &&
    !CONVERSATION_COMMANDS.some((entry) => entry.name === name)
    ? null
    : { name, argument }
}

function structuredRecognizedCommands(): readonly SlashCommandSuggestion[] {
  return [...STRUCTURED_AGENT_SESSION_SLASH_COMMANDS, ...CONVERSATION_COMMANDS]
}

/** Whether the chat host, rather than the agent, owns this command. Callers also
 *  use it to refuse attachments: a host command sends no message, so attachments
 *  would be silently dropped, whereas a pass-through command is a real send. */
export function isStructuredAgentSessionComposerCommand(
  text: string,
  agent: AgentType | undefined,
  snapshot: readonly SessionOptionDescriptor[],
  reported?: readonly AgentSessionSlashCommand[]
): boolean {
  const command = commandParts(text)
  const profile = getNativeChatAgentProfile(agent)
  return Boolean(
    (command &&
      (structuredRecognizedCommands().some((entry) => entry.name === command.name) ||
        reported?.some((entry) => entry.hostCommand && entry.name === command.name) ||
        profile?.conversationCommandAliases?.[command.name] ||
        profile?.sessionActions?.some((name) => name === command.name))) ||
    (agentSessionInteractionCommand(agent ?? '', text) !== null &&
      snapshot.some((entry) => entry.id === 'interactionMode'))
  )
}

/** Host actions send no message; /goal is an action only on hosts that set goals. */
export function isStructuredAgentSessionHostCommand(
  text: string,
  hostSetsGoals: boolean,
  agent: AgentType | undefined,
  snapshot: readonly SessionOptionDescriptor[],
  reported?: readonly AgentSessionSlashCommand[]
): boolean {
  return (
    isStructuredAgentSessionComposerCommand(text, agent, snapshot, reported) ||
    (hostSetsGoals && isStructuredAgentSessionGoalCommand(text))
  )
}

export function prepareStructuredAgentSessionComposerCommand(
  agent: AgentType,
  reported?: readonly AgentSessionSlashCommand[],
  snapshot: readonly SessionOptionDescriptor[] = []
): (text: string) => boolean {
  return (text) => isStructuredAgentSessionComposerCommand(text, agent, snapshot, reported)
}

/** `/clear` or `/compact` alone: a conversation command with nothing after it. */
export function isLoneStructuredAgentSessionConversationCommand(text: string): boolean {
  const command = commandParts(text.trim())
  return Boolean(
    command &&
    command.argument === '' &&
    CONVERSATION_COMMANDS.some((entry) => entry.name === command.name)
  )
}

/** `/goal …`, which the host answers only where it can set this session's goal. */
export function isStructuredAgentSessionGoalCommand(text: string): boolean {
  return commandParts(text)?.name === 'goal'
}

const GOAL_CONTROLS: ReadonlyMap<string, AgentSessionThreadGoalChange> = new Map([
  ['pause', { kind: 'status', status: 'paused' }],
  ['resume', { kind: 'status', status: 'active' }],
  ['clear', { kind: 'clear' }]
])

/** `/goal pause|resume|clear` controls the current goal; any other text is a new objective. */
export function structuredAgentSessionGoalChange(argument: string): AgentSessionThreadGoalChange {
  return GOAL_CONTROLS.get(argument.toLowerCase()) ?? { kind: 'set', objective: argument }
}

/** `/clear`, `/compact` and goal changes that start work change the conversation; pausing or clearing a goal does not. */
export function structuredAgentSessionCommandChangesConversation(text: string): boolean {
  const command = commandParts(text)
  if (command?.name === 'goal') {
    const change = command.argument ? structuredAgentSessionGoalChange(command.argument) : null
    return change?.kind === 'set' || (change?.kind === 'status' && change.status === 'active')
  }
  return (
    command?.name === 'clear' ||
    command?.name === 'new' ||
    command?.name === 'compress' ||
    command?.name === 'compact'
  )
}

/** `/goal` with nothing after it: an entrance to goal mode, not an objective. */
export function isBareStructuredAgentSessionGoalCommand(text: string): boolean {
  const command = commandParts(text)
  return command?.name === 'goal' && command.argument === ''
}

/** Goal mode strips an optional /goal prefix instead of treating it as objective text. */
export function structuredAgentSessionGoalObjective(text: string): string {
  const goal = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trimEnd())
  return goal ? (goal[1]?.trim() ?? '') : text.trim()
}

function unavailable(name: string): StructuredAgentSessionCommandOutcome {
  return {
    handled: true,
    accepted: true,
    ...structuredComposerFailure('commandUnavailable', { name })
  }
}

export async function dispatchStructuredAgentSessionComposerCommand(
  text: string,
  controller: StructuredAgentSessionComposerOptions,
  /** A conversation command left for the host, so the composer can release its draft. */
  onSent?: () => void
): Promise<StructuredAgentSessionCommandOutcome> {
  const interaction = agentSessionInteractionCommand(controller.agent ?? '', text)
  if (interaction !== null && controller.snapshot.some((entry) => entry.id === 'interactionMode')) {
    return {
      handled: true,
      accepted: await controller.setOption('interactionMode', interaction),
      error: null
    }
  }
  const command = commandParts(text)
  if (
    command &&
    controller.sessionCommands?.some((entry) => entry.hostCommand && entry.name === command.name)
  ) {
    return controller.runHostCommand
      ? { handled: true, ...(await controller.runHostCommand(command.name, command.argument)) }
      : unavailable(command.name)
  }
  const profile = getNativeChatAgentProfile(controller.agent)
  const action = profile?.sessionActions?.find((name) => name === command?.name)
  if (action && command) {
    return controller.runSessionAction
      ? { handled: true, ...(await controller.runSessionAction(action, command.argument)) }
      : unavailable(action)
  }
  if (command && profile?.conversationCommandAliases?.[command.name]) {
    command.name = profile.conversationCommandAliases[command.name]!
  }
  if (command?.name === 'goal' && controller.changeThreadGoal) {
    if (!command.argument) {
      return {
        handled: true,
        accepted: false,
        ...structuredComposerFailure('goalObjectiveMissing')
      }
    }
    // A refusal reaches the user through the session's own error surface.
    return {
      handled: true,
      accepted: await controller.changeThreadGoal(
        structuredAgentSessionGoalChange(command.argument)
      ),
      error: null
    }
  }
  if (
    !command ||
    !isStructuredAgentSessionComposerCommand(
      text,
      controller.agent,
      controller.snapshot,
      controller.sessionCommands
    )
  ) {
    return { handled: false, accepted: false, error: null }
  }
  if (command.name === 'clear' || command.name === 'compact') {
    if (command.argument && !(command.name === 'compact' && controller.compactInstructions)) {
      return {
        handled: true,
        accepted: false,
        ...structuredComposerFailure('commandTakesNoArguments', { name: command.name })
      }
    }
    if (
      !controller.conversationCommands?.includes(command.name) ||
      !controller.runConversationCommand
    ) {
      return {
        handled: true,
        accepted: false,
        ...structuredComposerFailure('commandUnsupportedByHost', { name: command.name })
      }
    }
    return {
      handled: true,
      ...(await (command.argument
        ? controller.runConversationCommand(command.name, command.argument, onSent)
        : controller.runConversationCommand(command.name, undefined, onSent)))
    }
  }
  if (command.name !== 'model' && command.name !== 'effort') {
    return unavailable(command.name)
  }
  const descriptor = controller.snapshot.find((entry) => entry.id === command.name)
  if (!command.argument) {
    const opened = await controller.invokeAction(command.name)
    return {
      handled: true,
      accepted: opened,
      ...(opened
        ? { error: null }
        : structuredComposerFailure(
            command.name === 'model' ? 'modelPickerFailed' : 'effortPickerFailed'
          ))
    }
  }
  const normalized = command.argument.toLowerCase()
  const choice =
    descriptor?.kind.type === 'select'
      ? descriptor.kind.choices.find(
          (entry) =>
            entry.value.toLowerCase() === normalized || entry.label.toLowerCase() === normalized
        )
      : undefined
  const value = choice?.value ?? command.argument
  const applied = await controller.setOption(command.name, value)
  return {
    handled: true,
    accepted: applied,
    ...(applied
      ? { error: null }
      : structuredComposerFailure(
          command.name === 'model' ? 'modelApplyFailed' : 'effortApplyFailed',
          { value: choice?.label ?? String(value) }
        ))
  }
}
