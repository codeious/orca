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
import { useTranslate } from '@/i18n/use-translate'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import {
  isAgentChatPermissionMode,
  type AgentChatPermissionMode
} from '../../../../../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import { composerPermissionDescriptor } from '../../../../../../../shared/native-chat/input/native-chat-session-option-snapshot'
import type {
  SessionOptionDescriptor,
  SessionOptionSelectChoice,
  SessionOptionsSurface
} from '../../../../../../../shared/native-chat/input/native-chat-session-options'
import {
  NATIVE_CHAT_PERMISSION_ICONS_BY_NAME,
  NATIVE_CHAT_PERMISSION_MODE_ICONS,
  nativeChatDeclaredChoiceCopy,
  nativeChatPermissionModeDescription,
  nativeChatPermissionModeLabel,
  nativeChatPermissionPickerTitle
} from './native-chat-permission-mode-labels'
import { runSessionOptionSurfaceCall } from './native-chat-session-option-surface-call'

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
      {props.truncate ? (
        <span data-composer-label className="truncate">
          {label}
        </span>
      ) : (
        <span>{label}</span>
      )}
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
  const t = useTranslate()
  return (
    <NativeChatPermissionName
      Icon={NATIVE_CHAT_PERMISSION_MODE_ICONS[props.mode]}
      label={nativeChatPermissionModeLabel(props.mode, t)}
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
  const t = useTranslate()
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
              {nativeChatPermissionModeDescription(mode, agent, t)}
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
  const t = useTranslate()
  useUiLanguageRevision()
  const title = nativeChatPermissionPickerTitle(t)
  const label = isAgentChatPermissionMode(current)
    ? nativeChatPermissionModeLabel(current, t)
    : current === 'own'
      ? t('settings.agents.permissionOwnAll', "Agents' own settings")
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
  const t = useTranslate()
  const title = nativeChatPermissionPickerTitle(t)
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
              aria-label={t(
                'components.native-chat.composer.pillAccessibleName',
                '{{value0}} {{value1}}',
                { value0: title, value1: label }
              )}
              className="max-w-40 min-w-0 shrink"
            >
              {name ?? (
                <>
                  <Settings2 className="size-3.5 shrink-0" aria-hidden />
                  <span data-composer-label className="truncate">
                    {label}
                  </span>
                </>
              )}
              <ChevronDown data-composer-label className="size-3" />
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

function NativeChatDeclaredPermissionPicker({
  optionId,
  current,
  choices,
  disabled,
  onSelect
}: {
  optionId: string
  current: string | undefined
  choices: readonly SessionOptionSelectChoice[]
  disabled: boolean
  onSelect: (value: string) => void
}): React.JSX.Element {
  useUiLanguageRevision()
  const copy = (choice: SessionOptionSelectChoice) =>
    nativeChatDeclaredChoiceCopy(optionId, choice.value)
  const icon = (choice: SessionOptionSelectChoice) =>
    choice.icon ? NATIVE_CHAT_PERMISSION_ICONS_BY_NAME[choice.icon] : Settings2
  const selected = choices.find((choice) => choice.value === current)
  return (
    <NativeChatPermissionPicker
      current={current}
      label={
        selected ? (copy(selected)?.label ?? selected.label) : nativeChatPermissionPickerTitle()
      }
      disabled={disabled}
      name={
        selected ? (
          <NativeChatPermissionName
            Icon={icon(selected)}
            label={copy(selected)?.label ?? selected.label}
            warning={selected.dangerous === true}
            truncate
          />
        ) : undefined
      }
    >
      {choices.map((choice) => {
        const description = copy(choice)?.description ?? choice.description
        return (
          <DropdownMenuRadioItem
            key={choice.value}
            value={choice.value}
            disabled={disabled}
            onSelect={() => onSelect(choice.value)}
          >
            <div className="min-w-0 py-0.5">
              <NativeChatPermissionName
                Icon={icon(choice)}
                label={copy(choice)?.label ?? choice.label}
                warning={choice.dangerous === true}
              />
              {description ? (
                <div className="text-xs font-normal text-muted-foreground">{description}</div>
              ) : null}
            </div>
          </DropdownMenuRadioItem>
        )
      })}
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
  if (descriptor.role === 'permission') {
    return (
      <NativeChatDeclaredPermissionPicker
        optionId={descriptor.id}
        current={current}
        choices={descriptor.kind.choices}
        disabled={!descriptor.settable}
        onSelect={(value) =>
          runSessionOptionSurfaceCall(value, NO_PENDING_MARK, () =>
            surface.setOption(descriptor.id, value)
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
