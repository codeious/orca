import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../native-chat/input/native-chat-session-options'
import type { StructuredAgentSessionOptionState } from './structured-agent-session-options'

export const AGENT_SESSION_SESSION_OPTIONS_CAPABILITY = 'agent-session.session-options.v1'

export function replaceSessionScopedOptions(
  state: StructuredAgentSessionOptionState,
  next: readonly SessionOptionDescriptor[] = []
): void {
  for (const row of state.sessionOptions ?? []) {
    if (row.scope === 'session') {
      delete state.record.values[row.id]
    }
  }
  for (const row of next) {
    if (
      row.scope === 'session' &&
      row.kind.currentValue !== undefined &&
      row.valueSource !== 'unknown'
    ) {
      state.record.values[row.id] = { value: row.kind.currentValue, source: row.valueSource }
    }
  }
}

export function sessionScopedOptionSnapshot(
  state: StructuredAgentSessionOptionState
): SessionOptionDescriptor[] {
  return (state.sessionOptions ?? [])
    .filter((row) => row.scope === 'session')
    .map((row) => {
      const tracked = state.record.values[row.id]
      if (!tracked) {
        return row
      }
      return {
        ...row,
        valueSource: tracked.source,
        kind:
          row.kind.type === 'select' && typeof tracked.value === 'string'
            ? { ...row.kind, currentValue: tracked.value }
            : row.kind.type === 'boolean' && typeof tracked.value === 'boolean'
              ? { ...row.kind, currentValue: tracked.value }
              : row.kind
      }
    })
}

export function sessionScopedOptionAccepts(
  row: SessionOptionDescriptor,
  value: SessionOptionValue
): boolean {
  return (
    row.scope === 'session' &&
    row.settable &&
    (row.kind.type === 'boolean'
      ? typeof value === 'boolean'
      : typeof value === 'string' && row.kind.choices.some((choice) => choice.value === value))
  )
}
