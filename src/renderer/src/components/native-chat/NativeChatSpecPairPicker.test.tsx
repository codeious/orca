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
import type {
  SessionOptionDescriptor,
  SessionOptionSpecPair,
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
    choices: [
      { value: 'main-model', label: 'Main Model' },
      { value: 'cheap-model', label: 'Cheap Model' }
    ]
  },
  valueSource: 'applied',
  transport: 'catalog',
  settable: true
}

const effort: SessionOptionDescriptor = {
  id: 'effort',
  label: 'Effort',
  category: 'thought_level',
  kind: {
    type: 'select',
    currentValue: 'high',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' }
    ]
  },
  valueSource: 'applied',
  transport: 'catalog',
  settable: true
}

const spec = (on: boolean): SessionOptionDescriptor => ({
  id: 'planMode',
  label: 'Spec',
  category: 'mode',
  kind: { type: 'boolean', currentValue: on },
  valueSource: 'applied',
  transport: 'catalog',
  settable: true
})

const UNSET: SessionOptionSpecPair = {
  model: null,
  effort: null,
  modelChoices: [
    { value: 'main-model', label: 'Main Model' },
    { value: 'cheap-model', label: 'Cheap Model' }
  ],
  effortChoices: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' }
  ],
  settable: true
}

const SET: SessionOptionSpecPair = {
  ...UNSET,
  model: 'cheap-model',
  effort: 'off',
  effortChoices: [
    { value: 'off', label: 'Off' },
    { value: 'medium', label: 'Medium' }
  ]
}

function surfaceWith(specPair?: SessionOptionSpecPair): SessionOptionsSurface {
  return {
    ...(specPair ? { specPair } : {}),
    getSnapshot: () => [],
    setOption: vi.fn(() => Promise.resolve({ snapshot: [] })),
    invokeAction: vi.fn(() => Promise.resolve({ snapshot: [] })),
    subscribe: () => () => {}
  }
}

async function renderPickers(
  surface: SessionOptionsSurface,
  snapshot: SessionOptionDescriptor[],
  isWorking = false
): Promise<void> {
  render(
    <TooltipProvider>
      <NativeChatSessionOptionPickers surface={surface} snapshot={snapshot} isWorking={isWorking} />
    </TooltipProvider>
  )
  await settle()
}

const specButton = (): HTMLElement | null =>
  screen
    .queryAllByRole('button')
    .find((button) => /Spec model/.test(button.getAttribute('aria-label') ?? '')) ?? null

/** The menu opens on pointerdown, which happy-dom does not synthesize, so press Enter instead. */
async function openSpecMenu(): Promise<void> {
  const trigger = specButton()
  if (!trigger) {
    throw new Error('no Spec model control')
  }
  fireEvent.keyDown(trigger, { key: 'Enter' })
  await settle()
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('the Spec model and effort control', () => {
  it('is drawn for a surface that offers the pair once Spec is on, naming no value while unset', async () => {
    await renderPickers(surfaceWith(UNSET), [model, effort, spec(true)])

    const trigger = specButton()
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toBe('Spec model')
  })

  it('is not drawn while Spec is off and no pair is set', async () => {
    await renderPickers(surfaceWith(UNSET), [model, effort, spec(false)])

    expect(specButton()).toBeNull()
  })

  it('stays drawn while Spec is off if a pair is still set, so a set pair is always visible', async () => {
    await renderPickers(surfaceWith(SET), [model, effort, spec(false)])

    expect(specButton()?.textContent).toBe('Spec: Cheap Model, Off')
  })

  it('shows the pair it holds and leaves the main pills as they are', async () => {
    await renderPickers(surfaceWith(SET), [model, effort, spec(true)])

    expect(specButton()?.textContent).toBe('Spec: Cheap Model, Off')
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels).toContain('Main Model')
    expect(labels.some((label) => label?.startsWith('High'))).toBe(true)
  })

  it('is not drawn for a surface without a pair, whatever the snapshot holds', async () => {
    await renderPickers(surfaceWith(), [model, effort, spec(true)])

    expect(specButton()).toBeNull()
  })

  it('sets the Spec model and then the Spec effort through the surface', async () => {
    const surface = surfaceWith(UNSET)
    await renderPickers(surface, [model, effort, spec(true)])

    await openSpecMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Cheap Model' }))
    await settle()
    expect(surface.setOption).toHaveBeenLastCalledWith('specModel', 'cheap-model')

    await openSpecMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
    await settle()
    expect(surface.setOption).toHaveBeenLastCalledWith('specEffort', 'high')
    expect(surface.setOption).toHaveBeenCalledTimes(2)
  })

  it('clears the pair with the same-as-main choice, which is how the surface is told to send null', async () => {
    const surface = surfaceWith(SET)
    await renderPickers(surface, [model, effort, spec(true)])

    await openSpecMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Same as main model' }))
    await settle()

    expect(surface.setOption).toHaveBeenCalledWith('specModel', 'same-as-main')
  })

  it('clears only the effort with the same-as-main effort choice', async () => {
    const surface = surfaceWith(SET)
    await renderPickers(surface, [model, effort, spec(true)])

    await openSpecMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Same as main effort' }))
    await settle()

    expect(surface.setOption).toHaveBeenCalledWith('specEffort', 'same-as-main')
  })

  it('marks the current model and effort as the selected choices', async () => {
    await renderPickers(surfaceWith(SET), [model, effort, spec(true)])

    await openSpecMenu()

    expect(
      screen.getByRole('menuitemradio', { name: 'Cheap Model' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Off' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(
      screen.getByRole('menuitemradio', { name: 'Same as main model' }).getAttribute('aria-checked')
    ).toBe('false')
  })

  it('names an effort as the effort pill does, with its description in the menu', async () => {
    const pair: SessionOptionSpecPair = {
      ...UNSET,
      effort: 'xhigh',
      effortChoices: [
        { value: 'low', label: 'low', description: 'Quick passes' },
        { value: 'xhigh', label: 'xhigh' }
      ]
    }
    await renderPickers(surfaceWith(pair), [model, effort, spec(true)])

    expect(specButton()?.textContent).toBe('Spec: Extra high')
    await openSpecMenu()
    const low = screen.getByRole('menuitemradio', { name: /^Low/ })
    expect(low.textContent).toBe('LowQuick passes')
    expect(screen.getByRole('menuitemradio', { name: 'Extra high' })).not.toBeNull()
  })

  it('is disabled while a turn runs, like the pills beside it', async () => {
    await renderPickers(surfaceWith(SET), [model, effort, spec(true)], true)

    expect(specButton()?.hasAttribute('disabled')).toBe(true)
  })
})
