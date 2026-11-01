import { ImeInput } from '@/lib/ime-text-field'
import { translate } from '@/i18n/i18n'

export function NativeChatQuestionSearch({
  value,
  disabled,
  onChange
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const label = translate('components.native-chat.question.search', 'Filter options')
  return (
    <div className="border-t border-border px-3.5 py-2">
      <ImeInput
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-default disabled:opacity-50"
      />
    </div>
  )
}
