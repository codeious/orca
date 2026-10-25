// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { useAppStore } from '@/store'
import { useSettingsNavigationMetadata } from './useSettingsNavigationMetadata'

let sections: SettingsNavSection[] = []
let root: Root
const originalSettings = useAppStore.getState().settings

function Probe(): null {
  sections = useSettingsNavigationMetadata()
  return null
}

async function listSections(updates: Partial<GlobalSettings>): Promise<string[]> {
  useAppStore.setState({ settings: { ...getDefaultSettings('/tmp'), ...updates } })
  await act(async () => {
    root.render(createElement(Probe))
  })
  return sections.map((section) => section.id)
}

beforeEach(() => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  useAppStore.setState({ settings: originalSettings })
  document.body.replaceChildren()
})

describe('the Chat settings page in navigation', () => {
  it('is listed when an agent is set to Chat and the Chat UI switch is off', async () => {
    expect(
      await listSections({ experimentalNativeChat: false, agentLaunchModes: { droid: 'chat' } })
    ).toContain('chat')
  })

  it('is listed when the Chat UI switch is on and no agent is set to Chat', async () => {
    expect(
      await listSections({ experimentalNativeChat: true, agentLaunchModes: { droid: 'terminal' } })
    ).toContain('chat')
  })

  it('is left out when the switch is off and no agent is set to Chat', async () => {
    expect(
      await listSections({ experimentalNativeChat: false, agentLaunchModes: { droid: 'terminal' } })
    ).not.toContain('chat')
  })
})
