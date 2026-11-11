import type { KeybindingInput } from '../keybindings'

export type ComposerKey =
  | 'shiftTab'
  | 'ctrlL'
  | 'tab'
  | 'ctrlN'
  | 'enter'
  | 'ctrlEnter'
  | 'ctrlC'
  | 'escape'

export type ComposerKeyActions = Partial<Record<ComposerKey, () => void>>

export type ComposerKeyMap = {
  match: (input: KeybindingInput, platform: NodeJS.Platform) => ComposerKey | null
  claims: Readonly<Partial<Record<NodeJS.Platform, readonly ComposerKey[]>>>
  /** Claimed keys whose chords Orca also binds. */
  windowShortcutKeys?: readonly ComposerKey[]
}

export function matchComposerKey(
  keyMap: ComposerKeyMap | undefined,
  input: KeybindingInput,
  platform: NodeJS.Platform
): ComposerKey | null {
  const key = keyMap?.match(input, platform) ?? null
  return key !== null && keyMap?.claims[platform]?.includes(key) ? key : null
}

export function getComposerWindowShortcutKeys(
  keyMap: ComposerKeyMap | undefined,
  platform: NodeJS.Platform
): readonly ComposerKey[] {
  return keyMap?.windowShortcutKeys?.filter((key) => keyMap.claims[platform]?.includes(key)) ?? []
}

export function composerOwnsWindowChord(
  keyMap: ComposerKeyMap | undefined,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const key = matchComposerKey(keyMap, input, platform)
  return key !== null && getComposerWindowShortcutKeys(keyMap, platform).includes(key)
}

export function composerKeyAction(
  keyMap: ComposerKeyMap | undefined,
  actions: ComposerKeyActions | undefined,
  event: KeybindingInput & { defaultPrevented: boolean },
  platform: NodeJS.Platform
): { key: ComposerKey; run: () => void } | null {
  const key = event.defaultPrevented ? null : matchComposerKey(keyMap, event, platform)
  const run = key ? actions?.[key] : undefined
  return key && run ? { key, run } : null
}
