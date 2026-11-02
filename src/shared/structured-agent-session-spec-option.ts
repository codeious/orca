import type { StructuredAgentSessionOptionRecord } from './agent-session/options/structured-agent-session-option-state'
import type { SessionOptionDescriptor } from './native-chat/input/native-chat-session-options'

/** A session-level switch remains available when the host has not named a model. */
export function withSpecModeSnapshot(
  snapshot: SessionOptionDescriptor[],
  record: StructuredAgentSessionOptionRecord
): SessionOptionDescriptor[] {
  if (!record.values.planMode) {
    return snapshot
  }
  const tracked = record.values.planMode
  const option: SessionOptionDescriptor = {
    id: 'planMode',
    label: 'Spec',
    category: 'mode',
    kind: {
      type: 'boolean',
      currentValue: tracked?.value === true
    },
    valueSource: tracked?.source ?? 'default',
    transport: 'agent-session',
    settable: true
  }
  return [...snapshot.filter((entry) => entry.id !== 'planMode'), option]
}
