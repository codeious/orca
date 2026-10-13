# What do /hooks saves and approval prompts do to Orca's Droid hooks?

## Question

[Does an existing hooks.json stop Droid from loading Orca's settings.json hooks?](https://github.com/codeious/orca/issues/16) settled how Droid loads hooks by observation. Two behaviors show only in a signed-in Droid terminal session (the TUI):

1. What the `/hooks` screen writes when it saves a hook and when its enable toggle is flipped.
2. Which hook events fire while an approval is on screen, and whether Orca's Droid terminal status would show `waiting`.

## Short answer

- **A `/hooks` save writes a new user `hooks.json` and leaves `settings.json` alone.** The new file holds every event from the `settings.json` `hooks` key, except `PermissionRequest`, plus the added hook. Its top-level keys are the event names, with no `hooks` wrapper. The `settings.json` `hooks` key stayed on disk, `PermissionRequest` included.
- **The copy in `hooks.json` wins.** After a save, an edit to the `settings.json` entry for an event never ran; the `hooks.json` copy did. Orca's own entries become stale copies Orca does not control.
- **The enable toggle writes `hooksDisabled` into `hooks.json`.** Off writes `true`, on writes `false`, and the key stays. With `true`, Orca's `settings.json` hooks went silent too, including `SessionStart`. The TUI says it "takes effect next turn". Orca's installed-hook check reads `hooksDisabled` only from `settings.json`, so it still reports installed.
- **No cleanup routine ran.** The `settings.json` `hooks` key survived the save, the toggle both ways, and a restart. The routine the binary hinted at was not reproduced.
- **Both approvals fire `PreToolUse`, then a `Notification`.** The `Notification` has type `permission_prompt` and the message `Factory CLI needs permission to execute 1 tool(s)`. It arrives 29 to 69 ms after `PreToolUse`. `PermissionRequest` never fires.
- **`riskLevel` is on commands, not edits.** `PreToolUse` for `Execute` carried `riskLevel: "low"`. `PreToolUse` for `ApplyPatch` carried only an `input` key.
- **Orca's current status shows `waiting` for both approvals**, through the `Notification`, after a `working` blip of under 70 ms. The code comment that says the approval path sends no `Notification` is wrong on 0.240.0.

## Evidence

### Setup

- Droid CLI 0.240.0 on macOS, run in the TUI through `config/scripts/capture-agent-pty-transcript.mjs` at 120 by 40.
- A throwaway `HOME`, never the real `~/.factory`. `FACTORY_API_KEY` came from a file and went only into the Droid process. `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, no `/login`, no Mission. `ORCA_*`, `FACTORY_SESSION_ID`, and `FACTORY_UPSTREAM_CLIENT_TYPE` were removed from the child environment.
- The profile's `settings.json` held Orca-shaped hooks (the eight events and matcher shapes from `src/main/droid/hook-service.ts`), with every command swapped for a logger script. Part 2 used a logger on all ten events. It also held one custom model at effort `low` and autonomy `off`.
- The working folder was empty. Trusting it through the TUI prompt added `trustedFolders` and `logoAnimation` to the profile's `settings.json`.
- A watcher polled both files every 100 ms and logged key names and hook script file names only.
- Cost: three paid runs reported 464, 462, and 462 `factoryCredits` (1,388 total), under the 3k cap. Every approval run ended while the prompt was on screen, so no tool ran and the folder stayed empty. A `Stop` and a `SessionEnd` appear in the raw logs only when the run is ended, so the fixtures drop them. A first command run was lost when a later control run overwrote its log, so it was run again. Both runs showed the same events in the same order.

### `/hooks` save

The `/hooks` screen has User, Project, Plugins, and Effective tabs. The User tab lists seven events and omits `PermissionRequest`, even though `settings.json` holds it. The add form says "Saving to user hooks.json" and has Event, Matcher, Execute command filter, Command, Timeout, and Save.

| Step | `settings.json` | `hooks.json` |
| --- | --- | --- |
| Before the save | `hooks` key with 8 events | absent |
| Form filled, before Save | unchanged | absent |
| Save (about 17 s) | unchanged | created: 7 event keys, `PermissionRequest` missing, `PreToolUse` lists the logger then the added hook |

A second save, from the ten-event profile, created `hooks.json` with nine event keys: all ten except `PermissionRequest`.

### Enable toggle

| Step | `settings.json` | `hooks.json` |
| --- | --- | --- |
| Toggle to Off | unchanged | adds top-level `hooksDisabled: true` |
| New session while Off | unchanged, no hook ran | unchanged |
| Toggle back to On | unchanged | `hooksDisabled: false` (key kept) |
| New session while On (control) | unchanged, one `SessionStart` ran | unchanged |

`hooksDisabled` is a boolean beside the event keys, not an event.

### Which copy wins

After a save, `settings.json` `SessionStart` was pointed at a second logger. A new session ran the logger saved in `hooks.json` once and the edited `settings.json` entry never. This agrees with [Does an existing hooks.json stop Droid from loading Orca's settings.json hooks?](https://github.com/codeious/orca/issues/16): `hooks.json` replaces `settings.json` per event within a level.

### Approvals at autonomy off

Hook events, in order. `dms` is milliseconds after `SessionStart`. The model took about 3 s to reach the tool in the edit run and the lost first command run, and 11.5 s in the rerun shown here. The gap between `PreToolUse` and `Notification` stayed under 70 ms (39 ms for the edit, 29 ms for the rerun, 69 ms for the lost first command run).

| Event | Edit (`ApplyPatch`) | Command (`Execute`) |
| --- | --- | --- |
| `SessionStart` | 0 | 0 |
| `UserPromptSubmit` | 7,428 | 7,399 |
| `PreToolUse` | 10,669 | 18,940 |
| `Notification` | 10,708 (+39 ms) | 18,969 (+29 ms) |
| `PermissionRequest` | never | never |

Payload keys, from the logged events:

- `SessionStart`: `CLAUDE_ENV_FILE`, `cwd`, `hook_event_name`, `permission_mode`, `session_id`, `source`, `transcript_path`.
- `UserPromptSubmit`: `cwd`, `has_images`, `hook_event_name`, `message_id`, `permission_mode`, `prompt`, `session_id`, `transcript_path`.
- `PreToolUse`: `cwd`, `hook_event_name`, `permission_mode`, `session_id`, `tool_input`, `tool_name`, `transcript_path`.
- `Notification`: `cwd`, `hook_event_name`, `message`, `notification_type`, `permission_mode`, `session_id`, `transcript_path`.

`tool_input` keys: `ApplyPatch` has `input`. `Execute` has `command`, `riskLevel` (`"low"` here), and `summary`.

The `Notification` has `notification_type: "permission_prompt"` and `message: "Factory CLI needs permission to execute 1 tool(s)"` in both runs. The screen offers "Yes, allow", "Yes, and always allow low impact commands (file edits and read-only commands)", and "No, cancel". The command prompt is headed "Command to approve · low risk".

### What Orca's Droid terminal status shows

Read from `src/shared/agent-hook-listener/providers/droid-events.ts`:

| Approval | `PreToolUse` | `Notification` | Row |
| --- | --- | --- | --- |
| Edit | `working` (no `riskLevel`, not AskUser) | message contains "permission", so `waiting` | `working` for 39 ms, then `waiting` |
| Command, low risk | `working` (`riskLevel` is `low`) | `waiting` | `working` for 29 to 69 ms, then `waiting` |

The `Notification` alone moves the row to `waiting` in both cases. No run showed `riskLevel: "high"` as the only signal.

## What this changes

- The comment in `droid-events.ts` that says the approval path emits no `Notification` hook is wrong on 0.240.0 for these two approvals.
- Any `/hooks` save leaves a stale copy of Orca's entries in `hooks.json` that overrides `settings.json` for those events. An installer or remover that writes only `settings.json` has no effect on them. The key-level writer for user `hooks.json` in ADR 0004 needs to update those entries too, and keep `hooksDisabled` and other non-event keys untouched.
- Orca's installed-hook check (`getStatus` in `src/main/droid/hook-service.ts`) reads `hooksDisabled` only from the top level of `settings.json`. The `/hooks` toggle writes it to `hooks.json`, so after a toggle to Off Orca still reports its hooks as installed while Droid runs none of them.

## Fixtures

`research/droid-hooks-approval-signals/`:

- `approval-edit.hook-events.jsonl`, `approval-command.hook-events.jsonl`: the logged events, with key names and `dms`.
- `hooks-save-and-toggle.disk-shapes.jsonl`, `hooks-restart-and-toggle-back.disk-shapes.jsonl`: file shapes (key names and hook script file names) on every change.
- `transcripts/`: raw PTY captures of the `/hooks` screen, the add form, the toggled-off screen, and both approvals. The repo scanner found no account identifiers.
- `probe/`: the logger scripts, the two settings skeletons, the watcher, the renderer, and the runner. To rerun, put `FACTORY_API_KEY=...` in a file, point `KEY_FILE` at it, and use the same throwaway layout.

## Unknowns and risks

- What happens after an approval is answered. Every run ended at the prompt, so `PostToolUse` and how `waiting` clears were not captured.
- Approvals above low risk, a `riskLevel: "high"` command, the AskUser tool, and Spec mode plan approval.
- The cleanup routine. The binary search only found a list of config file names. It may run under other conditions (project scope, plugin install, or a version upgrade).
- The Project, Plugins, and Effective tabs, and the "Show hook output" toggle.
- Droid 0.238.0 exactly. These runs are 0.240.0 on macOS, with one custom model.
- Removing Orca's entries from `settings.json` after a save was not run separately. That the `hooks.json` copy keeps running follows from the precedence test.

## Confidence

| Claim | Confidence |
| --- | --- |
| A save creates user `hooks.json` and leaves `settings.json` unchanged | high (two saves) |
| `PermissionRequest` is not copied to `hooks.json` | high (two saves) |
| The `hooks.json` copy wins over an edited `settings.json` entry | high (one test, matches issue 16) |
| The toggle writes `hooksDisabled` and silences `settings.json` hooks | high (write, silence, and enabled control) |
| Each approval fires `PreToolUse` then a `permission_prompt` `Notification` | high (edit once, command twice) |
| `riskLevel` is on `Execute` but not `ApplyPatch` | medium (one edit, two commands, low risk only) |
| No cleanup routine runs on save, toggle, or restart | medium (absence in one profile) |
