import { defineFixture } from '../../component-fixtures/component-fixture'
import { NativeChatSessionOptionRows } from './NativeChatSessionOptionRows'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat/input/native-chat-session-options'

const rows: SessionOptionDescriptor[] = [
  {
    id: 'autonomyLevel',
    label: 'Autonomy',
    scope: 'session',
    category: 'mode',
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true,
    kind: {
      type: 'select',
      currentValue: 'low',
      choices: ['off', 'low', 'medium', 'high'].map((value) => ({ value, label: value }))
    }
  },
  {
    id: 'specModel',
    label: 'Spec model',
    scope: 'session',
    category: 'mode',
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true,
    kind: {
      type: 'select',
      currentValue: 'same-as-main',
      choices: [
        { value: 'same-as-main', label: 'Same as main' },
        { value: 'planner', label: 'Planner' }
      ]
    }
  },
  {
    id: 'specEffort',
    label: 'Spec reasoning effort',
    scope: 'session',
    category: 'mode',
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true,
    kind: {
      type: 'select',
      currentValue: 'high',
      choices: [
        { value: 'same-as-main', label: 'Same as main' },
        { value: 'high', label: 'High' }
      ]
    }
  }
]
export const sessionScoped = defineFixture({
  width: 420,
  render: () => (
    <NativeChatSessionOptionRows
      options={rows}
      pendingIds={new Set()}
      shownReason={null}
      onSet={() => {}}
      onAction={() => {}}
    />
  )
})
