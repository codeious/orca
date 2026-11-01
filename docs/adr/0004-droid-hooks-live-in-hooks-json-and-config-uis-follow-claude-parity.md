---
status: accepted
---

# Orca's Droid hooks live in hooks.json, and Droid config UIs follow Claude parity

Orca installs its Droid status hooks into the user `hooks.json`, written the way a Droid `/hooks` save writes it, and no longer into the `hooks` key of `settings.json`. On Droid 0.238.0 an event defined in `hooks.json` replaces that event from the `settings.json` key at the same level, and `/hooks` saves write `hooks.json`. Orca's hooks in the key would be shadowed, and moved without Orca knowing, as soon as the user edits hooks in Droid. A Droid-only writer re-reads the file before each write and changes only Orca's entries, so it cannot drop keys that Droid or the user wrote in between. The status check reads the hooks Droid actually loads: both files, `hooks.hooksDisabled`, and the organization's `allowManagedHooksOnly`. `PermissionRequest` is dropped, because Droid never fires it. This matches Codex, whose Orca hooks also live in the agent's own `hooks.json`.

Droid's config UIs in Orca stop at what Claude and Codex already get: `.factory/mcp.json` joins the repository MCP section, and the Skills page shows Droid plugin skills read-only, like Claude plugin skills. Droid's other config (hooks, custom droids, slash commands, plugins, user-level MCP servers, skill on/off) is managed in Droid's own `/hooks`, `/droids`, `/commands`, `/plugins`, `/mcp`, and `/skills`. Mission Control is the one Droid-only feature in core, because it needs the structured-session adapter, worktrees, the sidebar, and the agent-status store.

## Considered Options

- **Keep Orca's hooks in the `settings.json` key and warn when `hooks.json` shadows an event.** Rejected. The first `/hooks` save can shadow or move Orca's hooks, and a warning does not bring the status back.
- **Write Orca's hooks into both files.** Rejected. Two copies of each entry drift, and removal has to find both.
- **Pass Orca's hooks per process with `--settings <path>`.** Rejected for now. A `droid` started by hand would report no status, and hook loading from that file is untested.
- **Native Orca UIs for every Droid config surface.** Rejected. They copy Droid's file formats and go stale with each release, and no other agent gets them.
- **A bundled Orca plugin for the Droid-only UIs.** Rejected. The plugin host API cannot read or write files on SSH and WSL hosts or run `droid` there, so it would need new host-API methods for one agent.

## Consequences

- The hook fix stays in `src/main/droid/` plus the `PermissionRequest` branches in `droid-events.ts` and `droid-tool-fields.ts`. The shared `installer-utils.ts` and the `AgentHookInstallStatus` type do not change. Only the reported config path does.
- Install, refresh, and remove migrate Orca's old entries out of the `settings.json` `hooks` key with a key-level edit that keeps every other key. Only Orca's entries are removed: the `hooks` key stays even when that leaves it empty, and anything the user keeps under it, such as `hooksDisabled`, is untouched.
- Orca's entries show up in Droid's `/hooks`. If a user deletes them there, Orca reinstalls them, as it does today.
- The status check resolves each Orca event separately, taking the file Droid loads for that event, and reads a set with any event shadowed or missing as not installed, so the installer repairs it. A user `hooks.json` that defines only `SessionStart` otherwise drops Orca's `SessionStart` while its `SessionEnd` from `settings.json` still fires, and the row keeps following the old lead after a session switch.
- Local, SSH, and WSL installs keep sharing one mutation, so the three hosts write the same `hooks.json` tree.
- A Droid-only config UI comes back only as a new effort, not as part of this one.
