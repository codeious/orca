// PROTOTYPE (throwaway, never merged): answers codeious/orca#13, "What should Mission Control look like
// in Orca?". Five variants on one page, switchable with ?variant=A..E, scenarios with ?state=, desktop or
// web client with ?client=, theme with ?theme=. Run: pnpm exec vite --config vite.mission-control-prototype.config.ts
import '../../assets/main.css'

import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MissionControlPrototypeSwitcher } from './MissionControlPrototypeSwitcher'
import { MissionControlVariantMobileCard, MissionControlVariantMobileScreen } from './MissionControlVariantMobile'
import { MissionControlVariantSidebar } from './MissionControlVariantSidebar'
import { MissionControlVariantStrip } from './MissionControlVariantStrip'
import { MissionControlVariantTab } from './MissionControlVariantTab'
import {
  buildMissionView,
  PROTOTYPE_VARIANTS,
  SCENARIOS,
  type ClientKind,
  type PrototypeVariantKey,
  type ScenarioId
} from './mission-control-prototype-data'

function readParam<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(window.location.search).get(key)
  return allowed.find((a) => a === value) ?? fallback
}

function PrototypeRoot(): React.JSX.Element {
  const [variant, setVariant] = useState(() => readParam('variant', PROTOTYPE_VARIANTS.map((v) => v.key), 'A'))
  const [scenario, setScenario] = useState(() => readParam('state', SCENARIOS.map((s) => s.id), 'running'))
  const [client, setClient] = useState(() => readParam<ClientKind>('client', ['desktop', 'web'], 'desktop'))
  const [theme, setTheme] = useState(() => readParam('theme', ['dark', 'light'] as const, 'dark'))
  const open = new URLSearchParams(window.location.search).get('open') === '1'
  const view = useMemo(() => buildMissionView(scenario), [scenario])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('variant', variant)
    params.set('state', scenario)
    params.set('client', client)
    params.set('theme', theme)
    window.history.replaceState(null, '', `?${params.toString()}`)
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [variant, scenario, client, theme])

  const key = `${variant}-${scenario}-${client}`
  const byVariant: Record<PrototypeVariantKey, React.JSX.Element> = {
    A: <MissionControlVariantSidebar key={key} view={view} client={client} />,
    B: <MissionControlVariantTab key={key} view={view} client={client} />,
    C: <MissionControlVariantStrip key={key} view={view} client={client} initiallyOpen={open} />,
    D: <MissionControlVariantMobileCard key={key} view={view} />,
    E: <MissionControlVariantMobileScreen key={key} view={view} />
  }
  return (
    <TooltipProvider delayDuration={400}>
      {byVariant[variant]}
      <MissionControlPrototypeSwitcher
        variant={variant}
        scenario={scenario}
        client={client}
        theme={theme}
        onVariant={setVariant}
        onScenario={(s: ScenarioId) => setScenario(s)}
        onClient={setClient}
        onTheme={setTheme}
      />
    </TooltipProvider>
  )
}

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(<PrototypeRoot />)
}
