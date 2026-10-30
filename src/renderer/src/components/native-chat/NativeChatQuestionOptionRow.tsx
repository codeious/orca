import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function NativeChatQuestionOptionRow({
  badge,
  label,
  description,
  selected,
  disabled,
  onSelect
}: {
  badge: string
  label: string
  description?: string
  selected: boolean
  disabled: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      // Selection is otherwise only the visual check/badge swap; expose it to
      // assistive tech.
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors disabled:pointer-events-none',
        selected ? 'bg-accent' : 'hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium',
          selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        )}
      >
        {selected ? <Check className="size-3.5" strokeWidth={3} /> : badge}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm text-foreground">{label}</span>
        {description ? (
          <span className="block break-words text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </button>
  )
}
