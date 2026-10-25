import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DROID_CHAT_VERSION_FLOOR } from '../../../../shared/droid-chat-version-floor'
import { AgentCatalogRow, type AgentCatalogRowProps } from './AgentCatalogRow'
import type { AgentLaunchModeControl } from './agent-launch-mode-control'

function control(overrides: Partial<AgentLaunchModeControl> = {}): AgentLaunchModeControl {
  return { value: 'follow', chatUiSwitchOn: false, onChange: vi.fn(), ...overrides }
}

// A command override opens the row's fields on first render, which static markup cannot toggle.
function renderRow(overrides: Partial<AgentCatalogRowProps> = {}): string {
  return renderToStaticMarkup(
    React.createElement(AgentCatalogRow, {
      agentId: 'droid',
      label: 'Droid',
      homepageUrl: 'https://factory.ai',
      defaultCmd: 'droid',
      defaultArgs: '',
      defaultEnv: {},
      isDetected: true,
      isEnabled: true,
      isDefault: false,
      cmdOverride: '/opt/droid',
      argsOverride: '',
      envOverride: {},
      onSetDefault: vi.fn(),
      onSetEnabled: vi.fn(),
      onSaveOverride: vi.fn(),
      onSaveArgs: vi.fn(),
      onSaveEnv: vi.fn(),
      launchMode: control(),
      ...overrides
    })
  )
}

describe('a Droid row with a launch mode', () => {
  it('puts the setting first among the expanded fields, above Command', () => {
    const markup = renderRow()

    expect(markup).toContain('Launch mode')
    expect(markup.indexOf('Launch mode')).toBeLessThan(markup.indexOf('>Command<'))
  })

  it('shows the chosen option', () => {
    expect(renderRow({ launchMode: control({ value: 'follow' }) })).toContain(
      'Follow Chat UI switch'
    )
    expect(renderRow({ launchMode: control({ value: 'terminal' }) })).toContain('>Terminal<')
    expect(renderRow({ launchMode: control({ value: 'chat' }) })).toContain('>Chat UI<')
  })

  it.each([
    [
      'follow',
      true,
      'New Droid sessions open in Chat UI, because the Chat UI switch in Experimental is on.'
    ],
    [
      'follow',
      false,
      'New Droid sessions open in the terminal, because the Chat UI switch in Experimental is off.'
    ],
    [
      'terminal',
      true,
      'New Droid sessions open in the terminal, whatever the Chat UI switch says.'
    ],
    ['chat', false, 'New Droid sessions open in Chat UI, whatever the Chat UI switch says.']
  ] as const)(
    'says what %s does with the switch %s, and always where chat is impossible',
    (value, chatUiSwitchOn, sentence) => {
      const markup = renderRow({ launchMode: control({ value, chatUiSwitchOn }) })

      expect(markup).toContain(sentence)
      expect(markup).toContain(
        `Droid always opens in the terminal on WSL and SSH workspaces, and when it is older than ${DROID_CHAT_VERSION_FLOOR}.`
      )
    }
  )

  it('is never disabled', () => {
    const markup = renderRow({ launchMode: control({ value: 'chat' }) })
    const trigger = markup.slice(
      markup.lastIndexOf('<button', markup.indexOf('Chat UI')),
      markup.indexOf('Chat UI')
    )

    expect(trigger).toContain('role="combobox"')
    // The class list carries Tailwind's `disabled:` variants, so look for the attribute itself.
    expect(trigger).not.toMatch(/\sdisabled(?=[=\s>])/)
    expect(trigger).not.toContain('data-disabled')
  })

  it('stays out of a row that has no launch mode', () => {
    const markup = renderRow({ launchMode: undefined, agentId: 'claude', label: 'Claude' })

    expect(markup).toContain('>Command<')
    expect(markup).not.toContain('Launch mode')
  })

  it('keeps an undetected Droid dimmed with no setting', () => {
    const markup = renderRow({ isDetected: false, launchMode: undefined })

    expect(markup).not.toContain('Launch mode')
    expect(markup).toContain('opacity-70')
  })
})
