// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { useDroidBugCommand } from './use-droid-bug-command'

const mocks = vi.hoisted(() => ({ call: vi.fn(), confirm: vi.fn() }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
const CHAT = { agent: 'droid', sessionId: 'chat-1', target: { kind: 'local' } } as const
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ConfirmationDialogContext.Provider, { value: mocks.confirm }, children)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.call.mockResolvedValue({ name: 'bug', submitted: true })
})

it('keeps the confirmation valid through an ordinary render of the same chat', async () => {
  let accept: (value: boolean) => void = () => {}
  mocks.confirm.mockReturnValue(
    new Promise<boolean>((resolve) => {
      accept = resolve
    })
  )
  const hook = renderHook((chat) => useDroidBugCommand(chat), {
    initialProps: { ...CHAT },
    wrapper
  })

  const waiting = hook.result.current('fake comment')
  hook.rerender({ ...CHAT })
  accept(true)
  expect(await waiting).toMatchObject({ accepted: true })
  expect(mocks.call).toHaveBeenCalledOnce()
})

it('does not submit after the chat was unmounted', async () => {
  let accept: (value: boolean) => void = () => {}
  mocks.confirm.mockReturnValue(
    new Promise<boolean>((resolve) => {
      accept = resolve
    })
  )
  const hook = renderHook(() => useDroidBugCommand(CHAT), { wrapper })
  const waiting = hook.result.current('fake comment')
  hook.unmount()
  accept(true)
  expect(await waiting).toEqual({ accepted: false, error: null })
  expect(mocks.call).not.toHaveBeenCalled()
})

it('does not submit when no confirmation provider is present', async () => {
  const hook = renderHook(() => useDroidBugCommand(CHAT))
  expect(await hook.result.current('fake comment')).toEqual({ accepted: false, error: null })
  expect(mocks.call).not.toHaveBeenCalled()
})

it('does not open a confirm or submit for Claude', async () => {
  const hook = renderHook(() => useDroidBugCommand({ ...CHAT, agent: 'claude' }), { wrapper })
  expect(await hook.result.current('fake comment')).toEqual({ accepted: false, error: null })
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})
