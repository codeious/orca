import {
  buildManagedCommandHook,
  createManagedCommandMatcher,
  hookDefinitionHasManagedCommand,
  isPlainObject,
  removeManagedCommands,
  type HookDefinition,
  type HooksConfig
} from '../agent-hooks/installer-utils'

// Why: SessionStart is installed (not just listened for) so that resuming a
// droid session via `droid --resume` resets the per-pane prompt/tool caches
// without waiting for the next UserPromptSubmit. Mirrors the codex pattern in
// src/main/codex/hook-service.ts.
export const DROID_EVENTS = [
  { eventName: 'SessionStart', definition: { hooks: [{ type: 'command', command: '' }] } },
  { eventName: 'UserPromptSubmit', definition: { hooks: [{ type: 'command', command: '' }] } },
  { eventName: 'Stop', definition: { hooks: [{ type: 'command', command: '' }] } },
  // Why: sub-droid completion is mission progress, not parent Droid completion.
  // The listener intentionally ignores SubagentStop so it cannot notify.
  { eventName: 'SubagentStop', definition: { hooks: [{ type: 'command', command: '' }] } },
  {
    eventName: 'PreToolUse',
    definition: { matcher: '*', hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'PostToolUse',
    definition: { matcher: '*', hooks: [{ type: 'command', command: '' }] }
  },
  { eventName: 'Notification', definition: { hooks: [{ type: 'command', command: '' }] } }
] as const

// Why: Droid's hook event enum has no PermissionRequest and a /hooks save leaves it out of hooks.json.
const EVENTS_DROID_NEVER_LOADS = new Set(['PermissionRequest'])

/** A `/hooks` save writes event names at the top level; non-event keys such as `hooksDisabled` sit beside them. */
export type DroidHooksFile = Record<string, unknown>

function eventDefinitions(file: DroidHooksFile, eventName: string): HookDefinition[] | null {
  const value = file[eventName]
  return Array.isArray(value) ? value : null
}

/**
 * Copies the settings.json `hooks` events that hooks.json does not define into hooks.json.
 * Droid lets a hooks.json event replace the settings.json event wholesale, so adding Orca's
 * entry to an event without carrying the user's own entries over would silence them.
 */
function carrySettingsHooksIntoHooksFile(hooksFile: DroidHooksFile, settings: HooksConfig): void {
  const settingsHooks: unknown = settings.hooks
  if (!isPlainObject(settingsHooks)) {
    return
  }
  for (const [eventName, definitions] of Object.entries(settingsHooks)) {
    if (
      !Array.isArray(definitions) ||
      EVENTS_DROID_NEVER_LOADS.has(eventName) ||
      Object.hasOwn(hooksFile, eventName)
    ) {
      continue
    }
    hooksFile[eventName] = structuredClone(definitions)
  }
}

/**
 * Removes Orca's entries from an event map (hooks.json, or the settings.json `hooks` object) and
 * returns whether any were found. Only an event Orca emptied is dropped; non-event keys such as
 * `hooksDisabled` and events without an Orca entry are never touched.
 */
function stripManagedEntries(
  events: Record<string, unknown>,
  isManagedCommand: (command: string | undefined) => boolean,
  keepEvents?: ReadonlySet<string>
): boolean {
  let changed = false
  for (const [eventName, value] of Object.entries(events)) {
    if (keepEvents?.has(eventName) || !Array.isArray(value)) {
      continue
    }
    if (
      !value.some((definition) => hookDefinitionHasManagedCommand(definition, isManagedCommand))
    ) {
      continue
    }
    const cleaned = removeManagedCommands(value, isManagedCommand)
    if (cleaned.length === 0) {
      delete events[eventName]
    } else {
      events[eventName] = cleaned
    }
    changed = true
  }
  return changed
}

function stripManagedEntriesFromSettings(
  settings: HooksConfig,
  isManagedCommand: (command: string | undefined) => boolean
): boolean {
  const settingsHooks: unknown = settings.hooks
  return isPlainObject(settingsHooks) ? stripManagedEntries(settingsHooks, isManagedCommand) : false
}

/** The two user-level files Droid merges per event, as parsed from disk. */
export type DroidHookFiles = { hooksFile: DroidHooksFile; settings: HooksConfig }

/** Removes Orca's entries from both files, reporting which ones changed so only those are written. */
export function applyDroidRemove(
  { hooksFile, settings }: DroidHookFiles,
  scriptFileName: string
): { hooksChanged: boolean; settingsChanged: boolean } {
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  return {
    hooksChanged: stripManagedEntries(hooksFile, isManagedCommand),
    settingsChanged: stripManagedEntriesFromSettings(settings, isManagedCommand)
  }
}

/**
 * The one install mutation local, SSH and WSL all run: Orca's entries go into hooks.json and
 * leave the settings.json `hooks` key. Every other key and entry in both files is left as found.
 * Returns whether settings.json changed; hooks.json is always rewritten and the writer skips an
 * identical result.
 */
export function applyDroidInstall(
  { hooksFile, settings }: DroidHookFiles,
  command: string,
  scriptFileName: string
): { settingsChanged: boolean } {
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  carrySettingsHooksIntoHooksFile(hooksFile, settings)

  // Why: sweep Orca's entries out of events it no longer subscribes to.
  stripManagedEntries(
    hooksFile,
    isManagedCommand,
    new Set<string>(DROID_EVENTS.map((event) => event.eventName))
  )

  for (const event of DROID_EVENTS) {
    const current = eventDefinitions(hooksFile, event.eventName) ?? []
    const definition: HookDefinition = {
      ...event.definition,
      hooks: [buildManagedCommandHook(command)]
    }
    hooksFile[event.eventName] = [...removeManagedCommands(current, isManagedCommand), definition]
  }

  return { settingsChanged: stripManagedEntriesFromSettings(settings, isManagedCommand) }
}
