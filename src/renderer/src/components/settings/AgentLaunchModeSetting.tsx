import { useId } from 'react'
import type { AgentLaunchModePreference } from '../../../../shared/agent-launch-mode-preference'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { AgentLaunchModeControl } from './agent-launch-mode-control'
import {
  getAgentLaunchModeFallbackNote,
  getAgentLaunchModeOptionLabel,
  getAgentLaunchModeResult,
  getAgentLaunchModeTitle
} from './agent-launch-mode-copy'

const OPTIONS: readonly AgentLaunchModePreference[] = ['follow', 'terminal', 'chat']

/** Never disabled: the pane cannot know the open workspace's host or Droid's version. */
export function AgentLaunchModeSetting({
  value,
  chatUiSwitchOn,
  onChange
}: AgentLaunchModeControl): React.JSX.Element {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs text-muted-foreground">
        {getAgentLaunchModeTitle()}
      </span>
      <Select
        value={value}
        onValueChange={(next) => {
          const chosen = OPTIONS.find((option) => option === next)
          if (chosen) {
            onChange(chosen)
          }
        }}
      >
        <SelectTrigger size="sm" aria-labelledby={labelId} className="w-full min-w-52">
          <SelectValue>{getAgentLaunchModeOptionLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {getAgentLaunchModeOptionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {getAgentLaunchModeResult({ preference: value, chatUiSwitchOn })}{' '}
        {getAgentLaunchModeFallbackNote()}
      </p>
    </div>
  )
}
