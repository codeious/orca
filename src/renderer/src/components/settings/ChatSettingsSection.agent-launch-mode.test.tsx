// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { ChatSettingsSection } from './ChatSettingsSection'
import { ActiveSettingsSectionProvider } from './SettingsSection'
import { getChatAppearanceSearchEntries } from './chat-appearance-search'

vi.mock('../../store', () => ({
  useAppStore: (selector: (value: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

afterEach(cleanup)

function renderChat(updates: Partial<GlobalSettings>) {
  return render(
    <ActiveSettingsSectionProvider value="chat">
      <ChatSettingsSection
        settings={{ ...getDefaultSettings('/tmp'), ...updates }}
        updateSettings={vi.fn()}
        writeSourceControlAiSettings={async () => {}}
        searchEntries={getChatAppearanceSearchEntries()}
        showDesktopOnlySettings
        isMounted
      />
    </ActiveSettingsSectionProvider>
  )
}

describe('Chat settings page for an agent that opens chats', () => {
  it('shows when an agent is set to Chat and the Chat UI switch is off', () => {
    renderChat({ experimentalNativeChat: false, agentLaunchModes: { droid: 'chat' } })

    expect(screen.getByRole('spinbutton', { name: 'Text size' })).toBeTruthy()
  })

  it('shows when the switch is on and no agent is set to Chat', () => {
    renderChat({ experimentalNativeChat: true, agentLaunchModes: { droid: 'terminal' } })

    expect(screen.getByRole('spinbutton', { name: 'Text size' })).toBeTruthy()
  })

  it('stays hidden when the switch is off and no agent is set to Chat', () => {
    const { container } = renderChat({
      experimentalNativeChat: false,
      agentLaunchModes: { droid: 'terminal' }
    })

    expect(container.querySelector('#chat')).toBeNull()
  })
})
