import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { DroidAutonomyLevel } from '../../../../shared/droid-autonomy-options'
import type { SessionOptionAutonomy } from '../../../../shared/native-chat-session-options'
import { useNativeChatPickerFocusReturn } from './native-chat-picker-focus-return'
import { PickerTrigger, type PickerShortcut } from './NativeChatSessionOptionPickerTrigger'

const CTRL_L: PickerShortcut = { keys: ['Ctrl', 'L'], ariaKeyShortcuts: 'Control+L' }

function levelLabel(level: DroidAutonomyLevel): string {
  switch (level) {
    case 'off':
      return translate('components.native-chat.composer.autonomyOff', 'Off')
    case 'low':
      return translate('components.native-chat.composer.autonomyLow', 'Low')
    case 'medium':
      return translate('components.native-chat.composer.autonomyMedium', 'Medium')
    case 'high':
      return translate('components.native-chat.composer.autonomyHigh', 'High')
  }
}

/**
 * Droid's autonomy level, beside the pills. Its own control rather than a row of the options menu:
 * the level is the session's, not a per-model option of the main model. Droid reads Ctrl+L on every
 * OS, so the key is named the same everywhere.
 */
export function NativeChatAutonomyPicker(props: {
  autonomy: SessionOptionAutonomy
  disabled: boolean
  pick: (level: DroidAutonomyLevel) => void
  focusComposer?: () => void
}): React.JSX.Element {
  const { autonomy, disabled, pick } = props
  const focus = useNativeChatPickerFocusReturn(props.focusComposer)
  const rowDisabled = !autonomy.settable || disabled
  return (
    <DropdownMenu>
      <PickerTrigger
        Trigger={DropdownMenuTrigger}
        label={translate('components.native-chat.composer.autonomyValue', 'Autonomy: {{value0}}', {
          value0: levelLabel(autonomy.level)
        })}
        tooltipLabel={translate(
          'components.native-chat.composer.autonomyHeading',
          'Autonomy level'
        )}
        disabled={disabled}
        dispatched={false}
        shortcut={CTRL_L}
      />
      <DropdownMenuContent
        align="start"
        side="top"
        collisionPadding={8}
        className="w-48"
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <DropdownMenuLabel>
          {translate('components.native-chat.composer.autonomyHeading', 'Autonomy level')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={autonomy.level}
          onValueChange={(value) => {
            const picked = autonomy.levels.find((level) => level === value)
            if (picked) {
              focus.notePick()
              pick(picked)
            }
          }}
        >
          {autonomy.levels.map((level) => (
            <DropdownMenuRadioItem key={level} value={level} disabled={rowDisabled}>
              {levelLabel(level)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
