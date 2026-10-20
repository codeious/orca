// PROTOTYPE (throwaway): floating variant and scenario switcher. Not part of any design being judged.
import React, { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import {
  PROTOTYPE_VARIANTS,
  SCENARIOS,
  type ClientKind,
  type PrototypeVariantKey,
  type ScenarioId
} from './mission-control-prototype-data'

type Props = {
  variant: PrototypeVariantKey
  scenario: ScenarioId
  client: ClientKind
  theme: 'dark' | 'light'
  onVariant: (v: PrototypeVariantKey) => void
  onScenario: (s: ScenarioId) => void
  onClient: (c: ClientKind) => void
  onTheme: (t: 'dark' | 'light') => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function MissionControlPrototypeSwitcher(props: Props): React.JSX.Element | null {
  const { variant, scenario, client, theme, onVariant, onScenario, onClient, onTheme } = props
  const index = PROTOTYPE_VARIANTS.findIndex((v) => v.key === variant)
  const step = (delta: number): void => {
    const next = (index + delta + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length
    onVariant(PROTOTYPE_VARIANTS[next].key)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) {
        return
      }
      if (e.key === 'ArrowLeft') {
        step(-1)
      } else if (e.key === 'ArrowRight') {
        step(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!import.meta.env.DEV) {
    return null
  }
  const mobile = variant === 'D' || variant === 'E'
  const selectClass = 'rounded bg-transparent px-1 py-0.5 text-xs outline-none'
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-2 py-1 text-xs text-background shadow-floating">
      <button type="button" className="rounded-full p-1 hover:opacity-70" onClick={() => step(-1)} aria-label="Previous variant">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[230px] text-center font-medium">
        {variant} · {PROTOTYPE_VARIANTS[index]?.name}
      </span>
      <button type="button" className="rounded-full p-1 hover:opacity-70" onClick={() => step(1)} aria-label="Next variant">
        <ChevronRight className="size-4" />
      </button>
      <span className="h-4 w-px bg-background/30" />
      <select className={selectClass} value={scenario} onChange={(e) => onScenario(SCENARIOS.find((s) => s.id === e.target.value)?.id ?? 'running')}>
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id} className="text-foreground">
            {s.label}
          </option>
        ))}
      </select>
      {mobile ? null : (
        <>
          <span className="h-4 w-px bg-background/30" />
          <select className={selectClass} value={client} onChange={(e) => onClient(e.target.value === 'web' ? 'web' : 'desktop')}>
            <option value="desktop" className="text-foreground">Desktop</option>
            <option value="web" className="text-foreground">Web client</option>
          </select>
          <button type="button" className="rounded-full p-1 hover:opacity-70" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </>
      )}
    </div>
  )
}
