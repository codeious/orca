import { describe, expect, it, vi } from 'vitest'
import { translate } from '@/i18n/i18n'
import {
  nativeChatModelPillLabel,
  nativeChatOptionsPillLabel,
  nativeChatSessionChoiceLabel
} from './native-chat-session-option-labels'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'

vi.mock('@/i18n/i18n', () => ({
  translate: vi.fn((_key: string, fallback: string) => fallback)
}))

function modelDescriptor(
  valueSource: SessionOptionDescriptor['valueSource'],
  currentValue?: string
): SessionOptionDescriptor {
  return {
    id: 'model',
    label: 'Model',
    valueSource,
    transport: 'catalog',
    settable: true,
    kind: {
      type: 'select',
      ...(currentValue ? { currentValue } : {}),
      choices: [{ value: 'grok-4.5', label: 'Grok 4.5' }]
    }
  }
}

describe('nativeChatModelPillLabel', () => {
  it('names a model the CLI defaulted to, not the bare category', () => {
    // This is the last step between `defaultModelIsCliDefault` and pixels: withholding
    // `default` here would silently undo the whole load-time default display.
    expect(nativeChatModelPillLabel(modelDescriptor('default', 'grok-4.5'))).toBe('Grok 4.5')
  })

  it('names a model the user picked', () => {
    expect(nativeChatModelPillLabel(modelDescriptor('applied', 'grok-4.5'))).toBe('Grok 4.5')
  })

  it('withholds a value it has no evidence for', () => {
    expect(nativeChatModelPillLabel(modelDescriptor('unknown', 'grok-4.5'))).toBe('Model')
    expect(nativeChatModelPillLabel(modelDescriptor('default'))).toBe('Model')
  })

  it('falls back to the raw id when the list no longer offers it', () => {
    // A discovered list can drop an id the record still tracks; showing the id beats
    // showing "Model" while a real model is running.
    expect(nativeChatModelPillLabel(modelDescriptor('reported', 'grok-build'))).toBe('grok-build')
  })
})

describe('nativeChatSessionChoiceLabel', () => {
  it('routes ultra through the localized effort label', () => {
    nativeChatSessionChoiceLabel({ value: 'ultra', label: 'Ultra' })

    expect(translate).toHaveBeenCalledWith(
      'components.native-chat.composer.optionValue.ultra',
      'Ultra'
    )
  })
})

describe('nativeChatSessionChoiceLabel for speed', () => {
  it('localizes Standard only inside the speed choice', () => {
    nativeChatSessionChoiceLabel({ value: 'default', label: 'Standard' }, 'serviceTier')
    expect(translate).toHaveBeenCalledWith(
      'components.native-chat.composer.optionValue.standard',
      'Standard'
    )
    expect(nativeChatSessionChoiceLabel({ value: 'default', label: 'Ask first' }, 'mode')).toBe(
      'Ask first'
    )
  })
})

describe('nativeChatOptionsPillLabel', () => {
  function speedDescriptor(currentValue: string): SessionOptionDescriptor {
    return {
      id: 'serviceTier',
      label: 'Speed',
      valueSource: 'reported',
      transport: 'agent-session',
      settable: true,
      kind: {
        type: 'select',
        currentValue,
        choices: [
          { value: 'default', label: 'Standard' },
          { value: 'priority', label: 'Fast' },
          { value: 'ultrafast', label: 'Ultrafast' }
        ]
      }
    }
  }

  it('names a faster tier and leaves Standard out, as Fast off was', () => {
    expect(nativeChatOptionsPillLabel([speedDescriptor('ultrafast')])).toBe('Ultrafast')
    expect(nativeChatOptionsPillLabel([speedDescriptor('default')])).toBe('Options')
  })

  describe('with the Spec switch', () => {
    function specDescriptor(
      currentValue: boolean,
      valueSource: SessionOptionDescriptor['valueSource'] = 'dispatched'
    ): SessionOptionDescriptor {
      return {
        id: 'planMode',
        label: 'Spec',
        category: 'mode',
        valueSource,
        transport: 'agent-session',
        settable: true,
        kind: { type: 'boolean', currentValue }
      }
    }
    const effort: SessionOptionDescriptor = {
      id: 'effort',
      label: 'Effort',
      valueSource: 'reported',
      transport: 'agent-session',
      settable: true,
      kind: {
        type: 'select',
        currentValue: 'off',
        choices: [{ value: 'off', label: 'Off' }]
      }
    }

    it('follows the effort with · Spec', () => {
      expect(nativeChatOptionsPillLabel([effort, specDescriptor(true)])).toBe('Off · Spec')
    })

    it('keeps · Spec as a suffix when the Spec switch is all the pill has to say', () => {
      expect(nativeChatOptionsPillLabel([specDescriptor(true)])).toBe('Options · Spec')
    })

    it('leaves the marker out while Spec is off or not yet known', () => {
      expect(nativeChatOptionsPillLabel([specDescriptor(false)])).toBe('Options')
      expect(nativeChatOptionsPillLabel([specDescriptor(false, 'unknown')])).toBe('Options')
      expect(nativeChatOptionsPillLabel([effort, specDescriptor(false)])).toBe('Off')
    })
  })
})
