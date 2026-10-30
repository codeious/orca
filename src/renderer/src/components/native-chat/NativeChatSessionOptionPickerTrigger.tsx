import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'

/** A key the pill answers to: the caps for the tooltip and the same chord for assistive tech. */
export type PickerShortcut = { keys: string[]; ariaKeyShortcuts: string }

function PickerTooltipContent(props: {
  label: string
  disabledReason?: string | null
  dispatched: boolean
  shortcut?: PickerShortcut
}): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      {props.shortcut && !props.disabledReason ? (
        <div className="flex items-center gap-2">
          <span>{props.label}</span>
          <ShortcutKeyCombo keys={props.shortcut.keys} />
        </div>
      ) : (
        <div>{props.disabledReason ?? props.label}</div>
      )}
      {props.dispatched ? (
        <div>
          {translate(
            'components.native-chat.composer.sentNotConfirmed',
            'Sent to the agent — not confirmed'
          )}
        </div>
      ) : null}
    </div>
  )
}

export function PickerTrigger(props: {
  /** The trigger of whichever surface the pill opens. */
  Trigger: typeof DropdownMenuTrigger | typeof PopoverTrigger
  label: string
  tooltipLabel: string
  disabled: boolean
  disabledReason?: string | null
  dispatched: boolean
  shortcut?: PickerShortcut
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
}): React.JSX.Element {
  // Why: value-only visible text must still include the category in the
  // accessible name (WCAG 2.5.3 Label in Name / voice control).
  const accessibleName =
    props.label === props.tooltipLabel
      ? props.tooltipLabel
      : translate('components.native-chat.composer.pillAccessibleName', '{{value0}} {{value1}}', {
          value0: props.tooltipLabel,
          value1: props.label
        })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <props.Trigger asChild disabled={props.disabled}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={accessibleName}
            aria-keyshortcuts={props.shortcut?.ariaKeyShortcuts}
            className="max-w-48"
            onKeyDown={props.onKeyDown}
          >
            <span className="truncate">{props.label}</span>
            <ChevronDown className="size-3" />
          </Button>
        </props.Trigger>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <PickerTooltipContent
          label={props.tooltipLabel}
          disabledReason={props.disabledReason}
          dispatched={props.dispatched}
          shortcut={props.shortcut}
        />
      </TooltipContent>
    </Tooltip>
  )
}
