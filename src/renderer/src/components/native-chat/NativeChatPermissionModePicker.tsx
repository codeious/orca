import { memo } from 'react'
import { ChevronDown, Settings2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import {
  isAgentChatPermissionMode,
  type AgentChatPermissionMode
} from '../../../../shared/agent-chat-permission-mode'
import {
  DROID_AUTONOMY_OPTION_ID,
  isDroidAutonomyLevel,
  type DroidAutonomyLevel
} from '../../../../shared/droid-autonomy-options'
import { composerPermissionDescriptor } from '../../../../shared/native-chat/input/native-chat-session-option-snapshot'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat/input/native-chat-session-options'
import {
  NATIVE_CHAT_PERMISSION_MODE_ICONS,
  nativeChatPermissionModeDescription,
  nativeChatPermissionModeLabel,
  nativeChatPermissionPickerTitle
} from './native-chat-permission-mode-labels'
import { runSessionOptionSurfaceCall } from './native-chat-session-option-surface-call'
import {
  nativeChatDroidPermissionDescription,
  nativeChatDroidPermissionLabel
} from './native-chat-droid-permission-labels'

const DROID_PERMISSION_ICONS = {
  off: NATIVE_CHAT_PERMISSION_MODE_ICONS.ask,
  low: NATIVE_CHAT_PERMISSION_MODE_ICONS['accept-edits'],
  medium: NATIVE_CHAT_PERMISSION_MODE_ICONS.auto,
  high: NATIVE_CHAT_PERMISSION_MODE_ICONS['full-access']
}

function NativeChatPermissionName(props: {
  Icon: LucideIcon
  label: string
  warning: boolean
  truncate?: boolean
}): React.JSX.Element {
  const { Icon, label } = props
  const body = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {props.truncate ? <span className="truncate">{label}</span> : <span>{label}</span>}
    </>
  )
  return props.warning ? (
    <span className="flex min-w-0 items-center gap-1.5 text-status-warning">{body}</span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5">{body}</span>
  )
}

export function NativeChatPermissionModeName(props: {
  mode: AgentChatPermissionMode
  truncate?: boolean
}): React.JSX.Element {
  return (
    <NativeChatPermissionName
      Icon={NATIVE_CHAT_PERMISSION_MODE_ICONS[props.mode]}
      label={nativeChatPermissionModeLabel(props.mode)}
      warning={props.mode === 'full-access'}
      truncate={props.truncate}
    />
  )
}

export function NativeChatPermissionModeItems({
  modes,
  agent,
  disabled,
  onSelect
}: Pick<
  NativeChatPermissionModePickerProps,
  'modes' | 'agent' | 'disabled' | 'onSelect'
>): React.JSX.Element {
  return (
    <>
      {modes.map((mode) => (
        <DropdownMenuRadioItem
          key={mode}
          value={mode}
          disabled={disabled}
          onSelect={() => onSelect(mode)}
        >
          <div className="min-w-0 py-0.5">
            <NativeChatPermissionModeName mode={mode} />
            <div className="text-xs font-normal text-muted-foreground">
              {nativeChatPermissionModeDescription(mode, agent)}
            </div>
          </div>
        </DropdownMenuRadioItem>
      ))}
    </>
  )
}

export type NativeChatPermissionModePickerProps = {
  current: string | undefined
  modes: readonly AgentChatPermissionMode[]
  /** Whose descriptions to show; absent describes every agent's. */
  agent?: string | null
  disabled?: boolean
  currentLabel?: string
  onSelect: (mode: AgentChatPermissionMode) => void
}

function NativeChatPermissionModePickerInner({
  current,
  modes,
  agent,
  disabled = false,
  onSelect,
  currentLabel
}: NativeChatPermissionModePickerProps): React.JSX.Element {
  useUiLanguageRevision()
  const title = nativeChatPermissionPickerTitle()
  const label = isAgentChatPermissionMode(current)
    ? nativeChatPermissionModeLabel(current)
    : current === 'own'
      ? translate('settings.agents.permissionOwnAll', "Agents' own settings")
      : (currentLabel ?? title)
  return (
    <NativeChatPermissionPicker
      current={current}
      label={label}
      disabled={disabled}
      name={
        isAgentChatPermissionMode(current) ? (
          <NativeChatPermissionModeName mode={current} truncate />
        ) : undefined
      }
    >
      <NativeChatPermissionModeItems
        modes={modes}
        agent={agent}
        disabled={disabled}
        onSelect={onSelect}
      />
    </NativeChatPermissionPicker>
  )
}

function NativeChatPermissionPicker({
  current,
  label,
  name,
  disabled,
  children
}: {
  current: string | undefined
  label: string
  name?: React.ReactNode
  disabled: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const title = nativeChatPermissionPickerTitle()
  // `shrink` overrides the button's shrink-0 so a narrow composer truncates the mode name.
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={translate(
                'components.native-chat.composer.pillAccessibleName',
                '{{value0}} {{value1}}',
                { value0: title, value1: label }
              )}
              className="max-w-40 min-w-0 shrink"
            >
              {name ?? (
                <>
                  <Settings2 className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                </>
              )}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {title}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-72">
        <DropdownMenuRadioGroup aria-label={title} value={current}>
          {children}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const NativeChatPermissionModePicker = memo(NativeChatPermissionModePickerInner)

function NativeChatDroidPermissionPicker({
  current,
  levels,
  disabled,
  onSelect
}: {
  current: string | undefined
  levels: readonly DroidAutonomyLevel[]
  disabled: boolean
  onSelect: (level: DroidAutonomyLevel) => void
}): React.JSX.Element {
  useUiLanguageRevision()
  return (
    <NativeChatPermissionPicker
      current={current}
      label={
        isDroidAutonomyLevel(current)
          ? nativeChatDroidPermissionLabel(current)
          : nativeChatPermissionPickerTitle()
      }
      disabled={disabled}
      name={
        isDroidAutonomyLevel(current) ? (
          <NativeChatPermissionName
            Icon={DROID_PERMISSION_ICONS[current]}
            label={nativeChatDroidPermissionLabel(current)}
            warning={current === 'high'}
            truncate
          />
        ) : undefined
      }
    >
      {levels.map((level) => (
        <DropdownMenuRadioItem
          key={level}
          value={level}
          disabled={disabled}
          onSelect={() => onSelect(level)}
        >
          <div className="min-w-0 py-0.5">
            <NativeChatPermissionName
              Icon={DROID_PERMISSION_ICONS[level]}
              label={nativeChatDroidPermissionLabel(level)}
              warning={level === 'high'}
            />
            <div className="text-xs font-normal text-muted-foreground">
              {nativeChatDroidPermissionDescription(level)}
            </div>
          </div>
        </DropdownMenuRadioItem>
      ))}
    </NativeChatPermissionPicker>
  )
}

const NO_PENDING_MARK = (): void => {}

/** The snapshot's permission descriptor, absent where the host states none; never locked by work. */
export function NativeChatComposerPermissionPicker({
  surface,
  snapshot,
  agent
}: {
  surface: SessionOptionsSurface | null
  snapshot: readonly SessionOptionDescriptor[]
  agent?: string
}): React.JSX.Element | null {
  const descriptor = composerPermissionDescriptor(snapshot)
  const current = descriptor?.kind.type === 'select' ? descriptor.kind.currentValue : undefined
  if (!surface || !descriptor || descriptor.kind.type !== 'select') {
    return null
  }
  if (descriptor.id === DROID_AUTONOMY_OPTION_ID) {
    return (
      <NativeChatDroidPermissionPicker
        current={current}
        levels={descriptor.kind.choices.map((choice) => choice.value).filter(isDroidAutonomyLevel)}
        disabled={!descriptor.settable}
        onSelect={(level) =>
          runSessionOptionSurfaceCall(level, NO_PENDING_MARK, () =>
            surface.setOption(descriptor.id, level)
          )
        }
      />
    )
  }
  const modes = descriptor.kind.choices
    .map((choice) => choice.value)
    .filter(isAgentChatPermissionMode)
  if (modes.length === 0) {
    return null
  }
  return (
    <NativeChatPermissionModePicker
      current={current}
      modes={modes}
      currentLabel={descriptor.description}
      agent={agent ?? null}
      disabled={!descriptor.settable}
      onSelect={(mode) => {
        // The report can match a new explicit pick while the chat still follows agent settings.
        runSessionOptionSurfaceCall(mode, NO_PENDING_MARK, () =>
          surface.setOption(descriptor.id, mode)
        )
      }}
    />
  )
}
