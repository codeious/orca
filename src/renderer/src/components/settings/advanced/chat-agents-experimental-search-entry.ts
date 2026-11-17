import type { SettingsSearchEntry } from '../search/settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../search/settings-search-keywords'

export function getChatAgentsExperimentalSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.experimental.search.chatAgents.title',
      'Experimental chat agents'
    ),
    description: translate(
      'auto.components.settings.experimental.search.chatAgents.description',
      'Offer chat agents that are still experimental for new chats.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.chatAgents.chat',
        'chat'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.chatAgents.agents',
        'agents'
      )
    ]
  }
}
