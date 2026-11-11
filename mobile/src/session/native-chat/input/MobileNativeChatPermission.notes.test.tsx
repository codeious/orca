import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Pressable: 'button',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Keyboard: { dismiss: () => {} },
  Platform: { OS: 'ios', select: (options: { ios: unknown }) => options.ios },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ ShieldQuestion: 'Icon', ChevronDown: 'Icon', X: 'Icon' }))
vi.mock('../transcript/MobileNativeChatMarkdown', () => ({
  MobileNativeChatMarkdown: () => null
}))

let renderer: ReactTestRenderer
afterEach(() => act(() => renderer?.unmount()))

function change(label: string, value: string): void {
  act(() => {
    renderer.root
      .findAll((node) => node.props.accessibilityLabel === label)[0]
      ?.props.onChangeText(value)
  })
}

async function press(label: string): Promise<void> {
  await act(async () => {
    await renderer.root
      .findAll(
        (node) =>
          String(node.type) === 'button' &&
          node
            .findAll((child) => String(child.type) === 'Text')
            .some((text) => text.children.includes(label))
      )[0]
      ?.props.onPress()
  })
}

function mount() {
  const answers: unknown[] = []
  act(() => {
    renderer = create(
      createElement(MobileNativeChatPermission, {
        permission: {
          title: 'Review',
          subject: { kind: 'plan', text: 'Create one file.' },
          acceptsComment: true,
          acceptsPlanEdit: true,
          options: [{ label: 'Proceed', send: 'go' }]
        },
        onRespond: async (...answer) => {
          answers.push(answer)
          return false
        }
      })
    )
  })
  return answers
}

it('delivers the comment and edited plan with the selected response', async () => {
  const answers = mount()
  change('Comment', 'Keep the scope small.')
  await press('Edit plan')
  change('Edited plan', 'Create one file and test it.')
  await press('Proceed')
  expect(answers).toEqual([
    ['go', { comment: 'Keep the scope small.', editedSpecContent: 'Create one file and test it.' }]
  ])
})

it('keeps the comment but excludes a discarded plan edit from the response', async () => {
  const answers = mount()
  change('Comment', 'Keep the scope small.')
  await press('Edit plan')
  change('Edited plan', 'Do not send this.')
  await press('Discard edits')
  await press('Proceed')
  expect(answers).toEqual([['go', { comment: 'Keep the scope small.' }]])
})
