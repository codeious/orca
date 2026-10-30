// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    values
      ? Object.entries(values).reduce(
          (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
          fallback
        )
      : fallback
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import type { DroidAutonomyLevel } from '../../../../shared/droid-autonomy-options'
import type {
  SessionOptionAutonomy,
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'

const settle = (): Promise<void> =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 30)))

const model: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: {
    type: 'select',
    currentValue: 'main-model',
    choices: [{ value: 'main-model', label: 'Main Model' }]
  },
  valueSource: 'applied',
  transport: 'catalog',
  settable: true
}

const FOUR: readonly DroidAutonomyLevel[] = ['off', 'low', 'medium', 'high']

function autonomy(
  level: DroidAutonomyLevel,
  levels: readonly DroidAutonomyLevel[] = FOUR,
  settable = true
): SessionOptionAutonomy {
  return { level, levels, settable }
}

function surfaceWith(value?: SessionOptionAutonomy): SessionOptionsSurface {
  return {
    ...(value ? { autonomy: value } : {}),
    getSnapshot: () => [],
    setOption: vi.fn(() => Promise.resolve({ snapshot: [] })),
    invokeAction: vi.fn(() => Promise.resolve({ snapshot: [] })),
    subscribe: () => () => {}
  }
}

async function renderPickers(surface: SessionOptionsSurface, isWorking = false): Promise<void> {
  render(
    <TooltipProvider>
      <NativeChatSessionOptionPickers surface={surface} snapshot={[model]} isWorking={isWorking} />
    </TooltipProvider>
  )
  await settle()
}

const autonomyButton = (): HTMLElement | null =>
  screen.queryAllByRole('button').find((button) => /Autonomy/.test(button.textContent ?? '')) ??
  null

/** The menu opens on pointerdown, which happy-dom does not synthesize, so press Enter instead. */
async function openMenu(): Promise<void> {
  const trigger = autonomyButton()
  if (!trigger) {
    throw new Error('no autonomy control')
  }
  fireEvent.keyDown(trigger, { key: 'Enter' })
  await settle()
}

const offered = (): string[] =>
  screen.getAllByRole('menuitemradio').map((item) => item.textContent ?? '')

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('the autonomy control', () => {
  it('names the level the chat holds', async () => {
    await renderPickers(surfaceWith(autonomy('high')))

    expect(autonomyButton()?.textContent).toBe('Autonomy: High')
  })

  it('tells assistive tech about Ctrl+L on every platform without putting the key in its name', async () => {
    await renderPickers(surfaceWith(autonomy('low')))

    expect(autonomyButton()?.getAttribute('aria-keyshortcuts')).toBe('Control+L')
    expect(autonomyButton()?.getAttribute('aria-label')).toBe('Autonomy level Autonomy: Low')
  })

  it('shows Ctrl+L as key caps in its tooltip', async () => {
    await renderPickers(surfaceWith(autonomy('low')))

    const trigger = autonomyButton()
    if (!trigger) {
      throw new Error('no autonomy control')
    }
    fireEvent.focus(trigger)
    await settle()

    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0)
    expect(screen.getAllByText('L').length).toBeGreaterThan(0)
  })

  it('is not drawn for a surface that names no level', async () => {
    await renderPickers(surfaceWith())

    expect(autonomyButton()).toBeNull()
  })

  it('offers Off, Low, Medium and High before the first message, marking the current one', async () => {
    await renderPickers(surfaceWith(autonomy('medium')))

    await openMenu()

    expect(offered()).toEqual(['Off', 'Low', 'Medium', 'High'])
    expect(screen.getByRole('menuitemradio', { name: 'Medium' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(screen.getByRole('menuitemradio', { name: 'High' }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })

  it('offers only the levels Droid reports, and shows the lowered one', async () => {
    await renderPickers(surfaceWith(autonomy('low', ['off', 'low'])))

    expect(autonomyButton()?.textContent).toBe('Autonomy: Low')
    await openMenu()

    expect(offered()).toEqual(['Off', 'Low'])
  })

  it('sets the picked level through the surface under autonomyLevel', async () => {
    const surface = surfaceWith(autonomy('high'))
    await renderPickers(surface)

    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Low' }))
    await settle()

    expect(surface.setOption).toHaveBeenCalledExactlyOnceWith('autonomyLevel', 'low')
  })

  it('cannot be changed while the chat cannot take a level', async () => {
    const surface = surfaceWith(autonomy('high', FOUR, false))
    await renderPickers(surface)

    await openMenu()

    expect(screen.getByRole('menuitemradio', { name: 'Low' }).getAttribute('aria-disabled')).toBe(
      'true'
    )
  })

  it('is disabled while a turn runs, like the pills beside it', async () => {
    await renderPickers(surfaceWith(autonomy('high')), true)

    expect(autonomyButton()?.hasAttribute('disabled')).toBe(true)
  })

  it('leaves the model pill as it is', async () => {
    await renderPickers(surfaceWith(autonomy('high')))

    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels).toContain('Main Model')
  })
})
