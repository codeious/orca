import { defineFixture } from '../../component-fixtures/component-fixture'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'

export const planNotes = defineFixture({
  width: 720,
  render: () => (
    <NativeChatApprovalCard
      approval={{
        title: 'Review proposed plan',
        subject: { kind: 'plan', text: '1. Update the parser.\n2. Add a regression test.' },
        acceptsComment: true,
        acceptsPlanEdit: true,
        options: [
          { label: 'Proceed', send: 'proceed_once' },
          { label: 'Keep planning', send: 'cancel' }
        ]
      }}
      onChoose={() => {}}
    />
  )
})
