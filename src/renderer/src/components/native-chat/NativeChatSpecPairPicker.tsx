import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import {
  DROID_SPEC_EFFORT_OPTION_ID,
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_SAME_AS_MAIN
} from '../../../../shared/droid-spec-pair-options'
import type {
  SessionOptionSelectChoice,
  SessionOptionSpecPair
} from '../../../../shared/native-chat-session-options'
import { useNativeChatPickerFocusReturn } from './native-chat-picker-focus-return'
import { nativeChatSessionChoiceLabel } from './native-chat-session-option-labels'
import { NativeChatSessionOptionChoiceBody } from './NativeChatSessionOptionChoiceBody'
import { PickerTrigger } from './NativeChatSessionOptionPickerTrigger'

function choiceLabel(choices: readonly SessionOptionSelectChoice[], value: string): string {
  return nativeChatSessionChoiceLabel(
    choices.find((choice) => choice.value === value) ?? { value, label: value }
  )
}

/** Nothing of the pair while it is unset: the control then names itself, never a value. */
function triggerLabel(pair: SessionOptionSpecPair): string {
  const values = [
    pair.model ? choiceLabel(pair.modelChoices, pair.model) : null,
    pair.effort ? choiceLabel(pair.effortChoices, pair.effort) : null
  ].filter((value) => value !== null)
  return values.length > 0
    ? translate('components.native-chat.composer.specPairValue', 'Spec: {{value0}}', {
        value0: values.join(', ')
      })
    : translate('components.native-chat.composer.specModel', 'Spec model')
}

/**
 * Droid's Spec model and effort, beside the pills it must not move. Its own control rather than a
 * row of the options menu: neither value is a per-model option of the main model.
 */
export function NativeChatSpecPairPicker(props: {
  pair: SessionOptionSpecPair
  disabled: boolean
  pick: (id: string, value: string) => void
  focusComposer?: () => void
}): React.JSX.Element {
  const { pair, disabled, pick } = props
  const focus = useNativeChatPickerFocusReturn(props.focusComposer)
  const choose = (id: string, value: string): void => {
    focus.notePick()
    pick(id, value)
  }
  const rowDisabled = !pair.settable || disabled
  return (
    <DropdownMenu>
      <PickerTrigger
        Trigger={DropdownMenuTrigger}
        label={triggerLabel(pair)}
        tooltipLabel={translate(
          'components.native-chat.composer.specModelAndEffort',
          'Spec model and effort'
        )}
        disabled={disabled}
        dispatched={false}
      />
      <DropdownMenuContent
        align="start"
        side="top"
        collisionPadding={8}
        className="w-60"
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <DropdownMenuLabel>
          {translate('components.native-chat.composer.specModelHeading', 'Spec model')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pair.model ?? DROID_SPEC_SAME_AS_MAIN}
          onValueChange={(value) => choose(DROID_SPEC_MODEL_OPTION_ID, value)}
        >
          <DropdownMenuRadioItem value={DROID_SPEC_SAME_AS_MAIN} disabled={rowDisabled}>
            {translate('components.native-chat.composer.specSameAsMainModel', 'Same as main model')}
          </DropdownMenuRadioItem>
          {pair.modelChoices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value} disabled={rowDisabled}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {pair.effortChoices.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {translate('components.native-chat.composer.specEffortHeading', 'Spec effort')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={pair.effort ?? DROID_SPEC_SAME_AS_MAIN}
              onValueChange={(value) => choose(DROID_SPEC_EFFORT_OPTION_ID, value)}
            >
              <DropdownMenuRadioItem value={DROID_SPEC_SAME_AS_MAIN} disabled={rowDisabled}>
                {translate(
                  'components.native-chat.composer.specSameAsMainEffort',
                  'Same as main effort'
                )}
              </DropdownMenuRadioItem>
              {pair.effortChoices.map((choice) => (
                <DropdownMenuRadioItem
                  key={choice.value}
                  value={choice.value}
                  disabled={rowDisabled}
                >
                  <NativeChatSessionOptionChoiceBody
                    label={nativeChatSessionChoiceLabel(choice)}
                    description={choice.description}
                  />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
