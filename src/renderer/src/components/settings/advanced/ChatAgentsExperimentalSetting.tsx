import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { useTranslate } from '@/i18n/use-translate'
import {
  forgetHostStructuredAgents,
  relearnHostStructuredAgents
} from '@/runtime/native-chat/agent-catalogs/host-structured-agents'
import { Label } from '../../ui/label'
import { Switch } from '../../ui/switch'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { getExperimentalSearchEntry } from './experimental-search'

type ChatAgentsExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function ChatAgentsExperimentalSetting({
  settings,
  updateSettings
}: ChatAgentsExperimentalSettingProps): React.JSX.Element {
  const t = useTranslate()
  const entry = getExperimentalSearchEntry().chatAgents
  const enabled = settings.experimentalChatAgents === true

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-3"
      id="experimental-chat-agents"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{entry.title}</Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.settings.ExperimentalPane.chatAgents.copy',
              'Offers chat agents that are still experimental when you start a new chat. Chats you already have keep opening while this is off.'
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          aria-label={t(
            'auto.components.settings.ExperimentalPane.chatAgents.toggleLabel',
            'Toggle experimental chat agents'
          )}
          onCheckedChange={async () => {
            await updateSettings({ experimentalChatAgents: !enabled })
            // This host's agent list was learned once; read it again so new chats follow the switch.
            forgetHostStructuredAgents(LOCAL_EXECUTION_HOST_ID)
            await relearnHostStructuredAgents(LOCAL_EXECUTION_HOST_ID, null, undefined)
          }}
        />
      </div>
    </SearchableSetting>
  )
}
