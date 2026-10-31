// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildNativeChatPickerItems } from './native-chat-picker-items'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'
import { useNativeChatComposerCatalog } from './use-native-chat-composer-catalog'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { getVerifiedNativeChatCommands } from '../../../../shared/native-chat-agent-profiles'
import { sessionSlashCommandSuggestions } from '../../../../shared/native-chat-slash-commands'
import { structuredSlashCommands } from '../../../../shared/structured-agent-session-composer'

const DROID_OWN_COMMANDS = [
  'help',
  'clear',
  'new',
  'quit',
  'exit',
  'context',
  'cost',
  'compress',
  'fork',
  'rename',
  'rewind-conversation'
]

function transport(sessionCommands?: NativeChatStructuredComposerTransport['sessionCommands']) {
  return { sessionCommands } as NativeChatStructuredComposerTransport
}

describe('composer catalog authority', () => {
  it('keeps PTY and unsupported structured providers on their original catalogs', () => {
    const pty = renderHook(() => useNativeChatComposerCatalog('claude'))
    expect(pty.result.current.agentCommands).toEqual(getVerifiedNativeChatCommands('claude'))
    expect(pty.result.current.sessionSkillNames).toBeUndefined()
    const oldHost = renderHook(() => useNativeChatComposerCatalog('claude', transport()))
    expect(oldHost.result.current.agentCommands).toEqual(structuredSlashCommands())
    expect(oldHost.result.current.sessionSkillNames).toBeUndefined()
  })
  it('offers supported conversation commands when the host has no reported catalog', () => {
    const { result, rerender } = renderHook(
      ({ conversationCommands }) =>
        useNativeChatComposerCatalog('claude', { ...transport(), conversationCommands }),
      {
        initialProps: {
          conversationCommands: ['clear', 'compact'] as NonNullable<
            NativeChatStructuredComposerTransport['conversationCommands']
          >
        }
      }
    )
    expect(result.current.agentCommands.map(({ name }) => name)).toEqual([
      'model',
      'effort',
      'clear',
      'compact'
    ])
    rerender({ conversationCommands: ['clear'] })
    expect(result.current.agentCommands.map(({ name }) => name)).toEqual([
      'model',
      'effort',
      'clear'
    ])
  })
  // Codex reports no catalog, so the hook's fallback is its entire `/` menu; the
  // agent has to reach structuredSlashCommands or `/goal` is invisible there.
  it('offers Codex the commands its model runs from message text', () => {
    const { result } = renderHook(() => useNativeChatComposerCatalog('codex', transport()))
    expect(result.current.agentCommands).toEqual(structuredSlashCommands([], 'codex'))
    expect(result.current.agentCommands.map(({ name }) => name)).toContain('goal')
  })
  it('leaves the Claude route on its own commands, reported or not', () => {
    const reported = [{ name: 'init', kind: 'command' as const }]
    const withReport = renderHook(() => useNativeChatComposerCatalog('claude', transport(reported)))
    expect(withReport.result.current.agentCommands).toEqual(
      sessionSlashCommandSuggestions('claude', reported)
    )
    const withoutReport = renderHook(() => useNativeChatComposerCatalog('claude', transport()))
    expect(withoutReport.result.current.agentCommands.map(({ name }) => name)).toEqual([
      'model',
      'effort'
    ])
  })
  it('offers a Droid chat the Droid commands, whether or not the host reports a catalog', () => {
    const unreported = renderHook(() => useNativeChatComposerCatalog('droid', transport()))
    expect(unreported.result.current.agentCommands.map(({ name }) => name)).toEqual([
      'model',
      'effort',
      ...DROID_OWN_COMMANDS
    ])
    const reported = renderHook(() =>
      useNativeChatComposerCatalog('droid', transport([{ name: 'my-command', kind: 'command' }]))
    )
    expect(reported.result.current.agentCommands.map(({ name }) => name)).toEqual([
      'my-command',
      ...DROID_OWN_COMMANDS
    ])
    const empty = renderHook(() => useNativeChatComposerCatalog('droid', transport([])))
    expect(empty.result.current.agentCommands.map(({ name }) => name)).toEqual(DROID_OWN_COMMANDS)
    for (const name of DROID_OWN_COMMANDS) {
      const row = unreported.result.current.agentCommands.find((entry) => entry.name === name)
      expect(row?.description?.trim()).toBeTruthy()
    }
  })
  // The host lists /clear as a conversation command for every agent; for Droid it starts a session.
  it('describes the Droid /clear as the Droid command, not as clearing the conversation context', () => {
    const { result } = renderHook(() =>
      useNativeChatComposerCatalog('droid', {
        ...transport(),
        conversationCommands: ['clear', 'compact']
      })
    )
    const rows = result.current.agentCommands.filter(({ name }) => name === 'clear')
    expect(rows).toEqual([
      { name: 'clear', description: 'Start a new session that keeps these settings' }
    ])
  })
  it('does not offer a Droid command twice when the host reports it too', () => {
    const { result } = renderHook(() =>
      useNativeChatComposerCatalog('droid', transport([{ name: 'help', kind: 'command' }]))
    )
    expect(result.current.agentCommands.map(({ name }) => name)).toEqual(DROID_OWN_COMMANDS)
  })
  it.each(['claude', 'codex', 'omp', 'openclaude', 'pi'])(
    'offers %s no Droid command, reported or not',
    (agent) => {
      const unreported = renderHook(() => useNativeChatComposerCatalog(agent, transport()))
      expect(unreported.result.current.agentCommands).toEqual(structuredSlashCommands([], agent))
      const reported = [{ name: 'init', kind: 'command' as const }]
      const withReport = renderHook(() => useNativeChatComposerCatalog(agent, transport(reported)))
      expect(withReport.result.current.agentCommands).toEqual(
        sessionSlashCommandSuggestions(agent, reported)
      )
      expect(unreported.result.current.agentCommands.map(({ name }) => name)).not.toContain('help')
    }
  )
  it('respects empty catalogs and command-only catalogs without reviving disk skills', () => {
    const { result, rerender } = renderHook(
      ({ reported }) => useNativeChatComposerCatalog('claude', transport(reported)),
      {
        initialProps: {
          reported: [] as NonNullable<NativeChatStructuredComposerTransport['sessionCommands']>
        }
      }
    )
    expect(result.current).toEqual({ agentCommands: [], sessionSkillNames: [] })
    rerender({ reported: [{ name: 'custom-command', kind: 'command' }] })
    expect(result.current).toEqual({
      agentCommands: [{ name: 'custom-command' }],
      sessionSkillNames: []
    })
  })
})

it('Enter completes a known pre-init skill while still dispatching a built-in command', () => {
  const reported = [
    { name: 'clear', kind: 'command' as const, kindUnspecified: true as const },
    { name: 'project-skill', kind: 'command' as const, kindUnspecified: true as const }
  ]
  const complete = vi.fn(),
    dispatch = vi.fn()
  const { result, rerender } = renderHook(
    ({ activeSuggestion }) => {
      const catalog = useNativeChatComposerCatalog('claude', transport(reported))
      const items = buildNativeChatPickerItems(
        catalog.agentCommands,
        [
          {
            id: 'project-skill',
            name: 'project-skill',
            description: 'Project skill',
            providers: ['claude'],
            sourceKind: 'repo',
            sourceLabel: 'Project',
            rootPath: '/project/.claude/skills',
            directoryPath: '/project/.claude/skills/project-skill',
            skillFilePath: '/project/.claude/skills/project-skill/SKILL.md',
            installed: true,
            updatedAt: null
          }
        ],
        '',
        '/',
        catalog.sessionSkillNames
      )
      return useNativeChatComposerKeyDown({
        autocomplete: {
          mode: 'slash',
          query: '',
          items,
          triggerKey: '/',
          prefix: '/',
          dispatchable: true,
          grouped: true,
          commandsEnabled: true,
          skillsEnabled: true,
          skillStatus: 'ready'
        },
        mentionFiles: { files: [], loading: false, failed: false },
        completeMention: vi.fn(),
        activeSuggestion,
        draft: '/',
        isComposing: () => false,
        completePickerItem: complete,
        dispatchPickerCommand: dispatch,
        dismissPicker: vi.fn(),
        interrupt: vi.fn(),
        send: vi.fn(),
        setActiveSuggestion: vi.fn(),
        setDraft: vi.fn(),
        setCaret: vi.fn()
      })
    },
    { initialProps: { activeSuggestion: 1 } }
  )
  const enter = { key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() } as unknown as Parameters<
    typeof result.current
  >[0]
  result.current(enter)
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'project-skill', kind: 'skill' })
  )
  expect(dispatch).not.toHaveBeenCalled()
  rerender({ activeSuggestion: 0 })
  result.current(enter)
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ name: 'clear', kind: 'command' }))
})
