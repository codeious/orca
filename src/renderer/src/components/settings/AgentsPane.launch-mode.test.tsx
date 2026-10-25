import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { AgentsPane, getAgentsPaneSearchEntries } from './AgentsPane'
import { matchesSettingsSearch } from './settings-search'
import { TooltipProvider } from '../ui/tooltip'
import { resolveSettingsHostScope } from './settings-host-scope'

const detectedAgentsMock = vi.hoisted((): { detectedIds: TuiAgent[] | null } => ({
  detectedIds: []
}))

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({
    detectedIds: detectedAgentsMock.detectedIds,
    isLoading: false,
    detectionFailed: false,
    isRefreshing: false,
    refresh: vi.fn()
  })
}))

// A command override opens a row's fields on first render, which static markup cannot toggle.
function renderPane(overrides: Partial<GlobalSettings> = {}): string {
  const settings: GlobalSettings = {
    ...getDefaultSettings('/tmp'),
    agentCmdOverrides: { droid: '/opt/droid', claude: '/opt/claude' },
    ...overrides
  }
  return renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(AgentsPane, {
        settings,
        updateSettings: vi.fn(),
        hostScope: resolveSettingsHostScope({
          choice: null,
          defaultEnvironmentId: settings.activeRuntimeEnvironmentId,
          savedEnvironmentIds: [],
          catalogHydrated: false
        })
      })
    )
  )
}

function occurrences(markup: string, text: string): number {
  return markup.split(text).length - 1
}

describe('the Droid launch mode in the Agents pane', () => {
  it('shows once, on Droid alone, when Droid is detected', () => {
    detectedAgentsMock.detectedIds = ['droid', 'claude']

    const markup = renderPane()

    expect(occurrences(markup, 'Launch mode')).toBe(1)
  })

  it('shows nothing for a Droid that is not detected', () => {
    detectedAgentsMock.detectedIds = ['claude']

    expect(renderPane()).not.toContain('Launch mode')
  })

  it('reads the stored choice and the Chat UI switch from settings', () => {
    detectedAgentsMock.detectedIds = ['droid']

    const markup = renderPane({
      experimentalNativeChat: true,
      agentLaunchModes: { droid: 'terminal' }
    })

    expect(markup).toContain('New Droid sessions open in the terminal, whatever the Chat UI switch')
    expect(markup).toContain('>Terminal<')
  })
})

describe('the launch mode in Settings search', () => {
  it.each(['launch mode', 'droid', 'chat ui', 'terminal', 'follow'])('finds it by %s', (query) => {
    const onlyThisEntry = getAgentsPaneSearchEntries().filter(
      (entry) => entry.title === 'Launch mode'
    )

    expect(onlyThisEntry).toHaveLength(1)
    expect(matchesSettingsSearch(query, onlyThisEntry)).toBe(true)
  })
})
