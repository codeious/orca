import { agentSessionInteractionCommand } from '../options/permissions/agent-session-interaction-mode'
import type { AgentType } from '../../agent-status/contracts/agent-status-types'
import type { SessionOptionDescriptor } from '../../native-chat/input/native-chat-session-options'
import type { SlashCommandSuggestion } from '../../native-chat/input/commands/native-chat-slash-commands'
import {
  CONVERSATION_COMMANDS,
  STRUCTURED_AGENT_SESSION_SLASH_COMMANDS
} from './structured-agent-session-slash-menu'
import type { AgentSessionThreadGoalChange } from '../agent-session-thread-goal-wire'
import type { AgentSessionSlashCommand } from '../agent-session-wire'
import { structuredComposerFailure } from '../failures/structured-agent-session-composer-failure'
import type {
  StructuredAgentSessionComposerOptions,
  StructuredAgentSessionCommandOutcome
} from './structured-agent-session-composer-contract'
export type {
  StructuredAgentSessionComposerOptions,
  StructuredAgentSessionCommandOutcome,
  StructuredAgentSessionCommandRefusalCause
} from './structured-agent-session-composer-contract'

function commandParts(text: string, agent?: AgentType) {
  if (!text.startsWith('/')) {
    return null
  }
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trimEnd())
  if (!match) {
    return null
  }
  const typed = match[1]!.toLowerCase()
  // Codex's /new starts a new chat, which its app-server would read as prose; `$` skills never share the name.
  const name = agent === 'codex' && typed === 'new' ? 'clear' : typed
  const argument = match[2]?.trim() ?? ''
  // Other commands take one line; a longer message that starts with their name is for the agent.
  return /[\n\r\u2028\u2029]/.test(argument) &&
    !CONVERSATION_COMMANDS.some((entry) => entry.name === name)
    ? null
    : { name, typed, argument }
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
  const command = commandParts(text, agent)
  return Boolean(
    (command &&
      (structuredRecognizedCommands().some((entry) => entry.name === command.name) ||
        reported?.some((entry) => entry.hostCommand && entry.name === command.name))) ||
    (agentSessionInteractionCommand(agent ?? '', text) !== null &&
      snapshot.some((entry) => entry.id === 'interactionMode'))
  )
}

/** Host actions send no message; /goal and /mcp are actions only where the host offers them. */
export function isStructuredAgentSessionHostCommand(
  text: string,
  hostSetsGoals: boolean,
  agent: AgentType | undefined,
  snapshot: readonly SessionOptionDescriptor[],
  opensMcpPanel = false,
  reported?: readonly AgentSessionSlashCommand[]
): boolean {
  return (
    isStructuredAgentSessionComposerCommand(text, agent, snapshot, reported) ||
    (hostSetsGoals && isStructuredAgentSessionGoalCommand(text)) ||
    (opensMcpPanel && commandParts(text)?.name === 'mcp')
  )
}

export function prepareStructuredAgentSessionComposerCommand(
  agent: AgentType,
  reported?: readonly AgentSessionSlashCommand[]
): (text: string) => boolean {
  const names = new Set(structuredRecognizedCommands().map((entry) => entry.name))
  return (text) => {
    const command = commandParts(text, agent)
    return (
      command !== null &&
      (names.has(command.name) ||
        reported?.some((entry) => entry.hostCommand && entry.name === command.name) === true)
    )
  }
}

/** `/clear`, `/compact` or `/new` alone: a conversation command with nothing after it, for any agent. */
export function isLoneStructuredAgentSessionConversationCommand(text: string): boolean {
  const command = commandParts(text.trim())
  return (
    command?.argument === '' &&
    (command.name === 'new' || CONVERSATION_COMMANDS.some((entry) => entry.name === command.name))
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
export function structuredAgentSessionCommandChangesConversation(
  text: string,
  agent: AgentType | undefined
): boolean {
  const command = commandParts(text, agent)
  if (command?.name === 'goal') {
    const change = command.argument ? structuredAgentSessionGoalChange(command.argument) : null
    return change?.kind === 'set' || (change?.kind === 'status' && change.status === 'active')
  }
  return command?.name === 'clear' || command?.name === 'compact'
}

/** `/goal` with nothing after it: an entrance to goal mode, not an objective. */
export function isBareStructuredAgentSessionGoalCommand(text: string): boolean {
  const command = commandParts(text)
  return command?.name === 'goal' && command.argument === ''
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
  const command = commandParts(text, controller.agent)
  if (command?.name === 'mcp' && controller.openMcpPanel) {
    controller.openMcpPanel()
    return { handled: true, accepted: true, error: null }
  }
  if (
    command &&
    controller.sessionCommands?.some((entry) => entry.hostCommand && entry.name === command.name)
  ) {
    return controller.runHostCommand
      ? { handled: true, ...(await controller.runHostCommand(command.name, command.argument)) }
      : unavailable(command.name)
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
        ...structuredComposerFailure('commandTakesNoArguments', { name: command.typed })
      }
    }
    if (
      !controller.conversationCommands?.includes(command.name) ||
      !controller.runConversationCommand
    ) {
      return {
        handled: true,
        accepted: false,
        ...structuredComposerFailure('commandUnsupportedByHost', { name: command.typed })
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
