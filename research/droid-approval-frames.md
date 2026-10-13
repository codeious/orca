# What do Droid's approval, block, and settings frames look like in a live session?

## Question

[How do Droid's modes and autonomy levels map onto Orca's controls?](https://github.com/codeious/orca/issues/9) settled how approvals, Spec mode, blocked commands, and the org's autonomy cap appear in Orca. Several of those rules rest on SDK types and docs only. This note captures the live `stream-jsonrpc` frames, so the spec's display rules and the adapter's fixtures are written against what Droid sends.

## Short answer

The display rules from [How do Droid's modes and autonomy levels map onto Orca's controls?](https://github.com/codeious/orca/issues/9) hold. Five details change what the adapter must read:

- **A block has no marker.** A command stopped by a `block` rule is an ordinary `tool_result` with `isError: true` and text addressed to the model. There is no permission request and no `userError` field in any frame. Orca cannot tell a block from another failed tool run by a field.
- **An autonomy cap clamps silently.** `droid.initialize_session` and `droid.update_session_settings` both succeed and Droid applies the cap. The only signal is the level in `settings_updated` and a shorter `availableAutonomyLevels`.
- **Every settings update is acknowledged, but the response says nothing.** The response is `result: {}`. The answer is the `settings_updated` whose `requestId` equals the request id, and it arrives before the response. Those frames were always complete. The unsolicited `settings_updated` can be partial, so the adapter must merge.
- **`droid.initialize_session` swaps a model the org blocks and reports success.** Only `droid.update_session_settings` returns the policy error. The adapter must compare the returned `modelId` with the one it asked for.
- **`autonomyMode` is a legacy field that hides the level in Spec mode.** It reads `spec` at every autonomy level while `interactionMode` is `spec`. Read `autonomyLevel` and `interactionMode`.

## Findings

### Setup

- Droid CLI 0.240.0 (newer than the 0.238.0 floor). Orca's side of the envelope used `factoryProtocolVersion` `1.201.1`. Droid answered with `1.260.0`.
- `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc`, spawned by `probe.mjs` with the user's own Droid login. `ORCA_*`, `FACTORY_SESSION_ID`, and `FACTORY_UPSTREAM_CLIENT_TYPE` were removed from the child environment, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, and the working directory was an empty folder under `/tmp`.
- Orca was the peer. The script answered `droid.request_permission` with `proceed_once` or `cancel` only and never chose an "always" or auto-run option, because those can write Droid's settings files. The probe's temp folder is not in the user's settings afterwards. No Mission was started.
- Project `permissionRules` in `.factory/settings.json` are ignored in an untrusted folder: `droid rules check --json` reports diagnostic code `workspace-untrusted` for them. Trust is a user-settings key the probe must not edit, so the rules and the cap rode a process-only overlay (`droid exec --settings <file>`). The overlays are in this folder.
- Models: every built-in model is blocked by this account's org policy (see "Model policy"). Every paid run used one custom (bring-your-own-key) model at reasoning effort `low`. Spec mode runs on `specModeModelId`, which defaults to the user's own, more expensive pick, so the probe pinned the spec model to the same custom model and stops if the pin fails. `probe.mjs` sends no prompt unless `settings_updated` confirms the pinned model.
- Cost: seven paid runs reported about 7.4k `factoryCredits` units in `agent_turn_completed.tokenUsage`: 6,590 across the five fixture runs, 836 for a run cut short by a settings change (below), and 0 for the run that fell back to a deprecated model. The settings, cap, and model-policy runs sent no prompt. These are Droid's own units for a custom model. They are not a bill, and the proxy provider's cost is not visible to the probe.

### Permission requests

All captured with Orca as the peer. `toolUses` held exactly one entry every time. `params` has only `toolUses` and `options`. Each entry has `toolUse`, `confirmationType`, and `details`.

| Autonomy | Situation | `confirmationType` (tool) | `details` keys | Options offered (`value`) |
| --- | --- | --- | --- | --- |
| `off` | `echo` command | `exec` (`Execute`) | `type`, `fullCommand`, `command`, `extractedCommands`, `impactLevel` (`low`) | `proceed_once`, `proceed_always`, `cancel` |
| `off` | create a file | `apply_patch` (`ApplyPatch`) | `type`, `filePath`, `fileName`, `patchContent`, `oldContent`, `newContent`, `files[]` (`operation: "create"`) | `proceed_once`, `proceed_always`, `cancel` |
| `off` | edit a file | `apply_patch` (`ApplyPatch`) | same, `operation: "update"` | `proceed_once`, `proceed_always`, `cancel` |
| `off` | `Read` of a file | no request | | |
| `high` | `echo` command, no rule | no request | | |
| `high` | create a file | no request | | |
| `high` | command matching an `ask` rule | `exec` | adds `riskLevelReason`: `Rule: <rule id>`. `impactLevel` is `high` | `proceed_once`, `cancel` |
| `high` | command in the legacy `commandDenylist` | `exec` | `riskLevelReason`: `Matched deny-list entry "<entry>". Deny-listed commands always require manual approval.` | `proceed_once`, `cancel` |
| `off` and `high` | Spec plan ready | `exit_spec_mode` (`ExitSpecMode`) | `type`, `plan`, `title` | `proceed_once`, `proceed_auto_run_low`, `proceed_auto_run_medium`, `proceed_auto_run_high`, `proceed_new_session`, `proceed_new_session_low`, `proceed_new_session_medium`, `proceed_new_session_high`, `cancel` |

Labels, as Droid wrote them:

- `proceed_once`: "Yes, allow". For a plan: "Proceed with implementation".
- `proceed_always`: "Yes, and always allow low impact commands (file edits and read-only commands)".
- `cancel`: "No, cancel". For a plan: "No, keep iterating on spec".
- Plan auto-run: "Proceed, and allow file edits and read-only commands (Low)", "Proceed, and allow reversible commands (Medium)", "Proceed, and allow all commands (High)".
- Plan new session: "Proceed in a new session (no autonomy)", then "(Low autonomy)", "(Medium autonomy)", "(High autonomy)".
- Every option has a `selectedColor`, and `cancel` also has a `selectedPrefix`. Neither is a contract.

What this answers:

- The plan approval offered `proceed_once` at both `off` and `high`. `proceed_edit` was not offered. The new-session options are offered at both levels, so hiding them is Orca's decision.
- At `off` with a peer connected, Droid sends `droid.request_permission` and waits. It does not fail the tool or reject it. The order is `executing_tool`, phase `queued`, `waiting_for_tool_confirmation`, then the request (the last two in the same millisecond). After the answer come `executing_tool`, `permission_resolved` (`requestId`, `toolUseIds`, `selectedOption`), and phase `executing`.
- This model used `ApplyPatch` for both create and edit, so the `edit` and `create` confirmation types were not observed. Which tool a model picks is the model's choice.
- Cancelling a plan returned a failed `tool_result` ("Error: Plan not approved - remaining in Spec Mode. Provide feedback to refine the spec."). The turn then completed with reason `completed`. No `settings_updated` followed, so the session stayed in Spec mode.

### Block

- A command matching a native `block` rule, and one in the legacy `commandBlocklist`, produced no permission request. Each gave a `tool_result` (keys `type`, `toolUseId`, `messageId`, `content`, `isError`) with `isError: true` and this text, where the quoted part is the rule id or the list entry:

  `Error: This command is blocked by your organization's security policy and can never be run (matched blocked-command rule "<id or entry>"). Do not run this command again, and do not attempt to bypass or work around this block using alternate syntax, encoding, escaping, or another tool. If this command is genuinely required, stop and ask the user to update their blocked-commands policy.`

- The tool run reached phase `queued` and never `executing`.
- `userError` appears in no frame of any run.
- The text says "organization" even when the rule came from a process overlay. It is addressed to the model, not to a person. Orca should show it as the failed tool run's output and not parse it.
- The docs say a `block` has no approval path and still applies when permission prompts are skipped (`--skip-permissions-unsafe`). That was not run.
- Droid's built-in safety list was **not** observed. `droid rules check --json` lists three built-in rules, all `allow` (`builtin/directory-list-allow`, `builtin/pwd-allow`, `builtin/git-inspection-allow`). The docs say recognized default list entries are handled by built-in rules or "runtime safeguards", so the safety list may not be a rule at all. Running a default entry live means running a destructive command, so the legacy lists stand in: both use a harmless token and show the same mechanism (a deny-list entry asks, a block-list entry blocks).

### Settings updates

- **Acknowledgement.** Each of the 8 `droid.update_session_settings` calls in `update-settings-acks.jsonl` got exactly one `settings_updated` whose `requestId` equals the request's JSON-RPC id, before the response. All 16 such frames across every raw log were full snapshots (each had `autonomyLevel` and `modelId`).
- **Unsolicited updates.** A valid `autonomyLevel` or `interactionMode` also produced one `settings_updated` with no `requestId`, in the same millisecond and ahead of the acknowledgement. It came even when the level did not change (the `maxAutonomyLevel` runs below). An invalid level and empty params produced only the acknowledgement. Of 31 unsolicited frames in all raw logs, 2 were partial. They held only `availableAutonomyLevels`, `migrationActive`, `specModeModelId`, and `specModeReasoningEffort`, and came from pinning the spec model.
- **Keys.** A full snapshot holds `autonomyLevel`, `autonomyMode`, `interactionMode`, `availableAutonomyLevels`, `modelId`, `reasoningEffort`, `specModeModelId`, `specModeReasoningEffort`, `compactionThresholdCheckEnabled`, `migrationActive`, and, in later frames, `additionalToolIds`, `enabledToolIds`, `disabledToolIds`, `restrictToolIds`, `toolExecutionMode`, and `allowSubagentsInScripts`.
- **`autonomyMode`.** It is `normal` for `off` in auto mode, `auto-low`, `auto-medium`, or `auto-high` for the same level in auto mode, and `spec` for every level in Spec mode.
- **Invalid level.** `autonomyLevel: "ultra"` returned success and changed nothing. The acknowledgement reported the old level.
- **Cap.** With the overlay `maxAutonomyLevel: "medium"`:
  - `droid.initialize_session` asking for `high` succeeded and reported `autonomyLevel: "medium"`, with `availableAutonomyLevels` of `["off","low","medium"]`.
  - `droid.update_session_settings` to `high` succeeded and the acknowledgement reported `medium`. From `off`, a request for `high` also landed on `medium`.
  - Neither call returned an error.
  - This account has no org cap (`availableAutonomyLevels` is all four without the overlay). The cap here came from a process overlay, not from org policy.
- **Spec mode.** `interactionMode: "spec"` worked at `droid.initialize_session` and through `droid.update_session_settings`. Pinning `specModeModelId` and `specModeReasoningEffort` the same way worked.

### Model policy

- Every built-in model is blocked by this account's org policy. `droid.update_session_settings` with one returned JSON-RPC error `-32603`: "Model not allowed by organization policy: This model is not available due to your organization's security settings."
- `droid.initialize_session` with the same blocked model returned success with a different model in the response (`claude-opus-4-7-fast`). Two `settings_updated` frames showed the swap just before the response. Each of the three prompts then failed with an `error` notification ("Opus 4.7 Fast Mode is deprecated and no longer available. Please select a different model."), a `create_message` carrying the same text, and `agent_turn_completed` with reason `error` and 0 credits. No tool ran.
- A custom model can be removed from Droid's settings while a session runs. One run did that: the first turn ran a tool, then `agent_turn_completed` reported reason `error` after an `error` notification ("Custom model configuration is unavailable") and a `create_message` ("BYOK Error: Custom model `<name>` is not configured in the current settings. Please select a different model."). Later turns failed the same way. The user's Droid `settings.json` has a modification time inside that run, and the custom model ids in it now have a different shape than the id the run was started with. The probe does not write that file. Many other Droid processes were running, so the writer is not known. That run is not a fixture, because its text names the user's model.

## Fixtures

`research/droid-approval-frames/`:

- `update-settings-acks.jsonl`: eight `droid.update_session_settings` calls, no prompt.
- `autonomy-cap-clamp.jsonl`: the `maxAutonomyLevel` overlay, no prompt.
- `autonomy-off-exec-and-patch.jsonl`: `exec` and two `apply_patch` requests at `off`, with `permission_resolved`.
- `autonomy-high-rules.jsonl`: a plain command, an `ask` rule, a `block` rule, and a file create at `high`.
- `legacy-blocklist-and-denylist.jsonl`: a legacy `commandBlocklist` entry and a `commandDenylist` entry.
- `spec-plan-approval-off.jsonl`, `spec-plan-approval-high.jsonl`: the `exit_spec_mode` request and the cancel.
- `model-blocked-by-org.jsonl`: the `initialize_session` model swap, then the `-32603` error from an update.
- `model-substituted-turn-error.jsonl`: three failed turns after the swap.

Each line is `{ t, dir, frame }`. `dir` is `out` (Orca to Droid), `in` (Droid to Orca), or `mark` (the probe's own note). `scrub.mjs` keeps these notification types: `create_message`, `tool_call` (the last one per tool use), `tool_execution_phase_changed`, `tool_result`, `droid_working_state_changed`, `assistant_text_complete`, `permission_resolved`, `settings_updated`, `agent_turn_completed`, and `error`. Everything else is dropped (hooks, MCP, titles, token usage, text deltas, and any incoming request other than `droid.request_permission`), as are `_meta` and `llm_only` system messages. The `droid.initialize_session` result is cut to the session id and its settings. Session, message, and tool ids are renumbered, custom model ids become `<custom-model-N>`, and the temp working directory and machine id become placeholders. A scan of the output found no home paths, user names, e-mail addresses, keys, base URLs, or proxy names. Raw logs were not committed.

To rerun: copy the `overlay-*.json` files to `/tmp/droid-approval-probe/`, run `probe.mjs` per scenario (header lists the scenarios and the `OVERLAY` and `INIT_LEVEL` variables), then `PROBE_MODEL=<model id> node scrub.mjs`. `summarize.mjs` prints a raw log as a timeline.

## Evidence log

- `droid --version` is 0.240.0. `droid exec --help` (stream-jsonrpc; `--settings <path>` merges a settings file for that process only). `droid rules check --help` and `--json`.
- [Permission rules](https://docs.factory.com/autonomy-and-safety/permission-rules.md): decisions `allow`, `ask`, `block`; legacy `commandDenylist` maps to `ask` and `commandBlocklist` to `block`; project and folder rules need workspace trust; default entries are handled by built-in rules or runtime safeguards.
- `@factory/droid-sdk@0.9.1` declarations: `ToolConfirmationOutcome`, `RequestPermissionRequestParamsSchema`, `UpdateSessionSettingsRequestParamsSchema`, and the `settings_updated` notification (`requestId` optional).
- Live runs, as above. Orca: `docs/adr/0002-plan-mode-is-an-agent-neutral-session-option.md`, and the resolution of [How do Droid's modes and autonomy levels map onto Orca's controls?](https://github.com/codeious/orca/issues/9).

## Unknowns and risks

- Droid's built-in safety-list entries (see "Block").
- A real org-managed `maxAutonomyLevel`. The cap here came from a process overlay.
- The `edit` and `create` confirmation types, `mcp_tool`, `sandbox_violation`, `droid_shield_violation`, and `proceed_edit`. No run produced them.
- What an "always" or auto-run option changes. Choosing one can write Droid's settings, so the probe never did.
- Cancelling an `exec` or `apply_patch` request (only a plan was cancelled), an unanswered request, and a permission request while a steering message is pending (see [Does a message sent with end_of_turn reach Droid before its agent loop ends?](https://github.com/codeious/orca/issues/20)).
- Several tool uses in one request. Every request here held one.
- Droid 0.238.0 exactly. These frames are 0.240.0.
- The model decides whether to call a tool, and which one. A fixture must not depend on a model's choice.
- Whether a custom model's Droid-reported credits match any real charge.

## Confidence

| Finding | Confidence |
| --- | --- |
| At `off`, a connected peer gets `droid.request_permission` for `exec` and `apply_patch` | high (three requests, two shapes) |
| The plan approval offers the same nine options at `off` and `high` | medium (one run at each level) |
| A native or legacy block is an `isError` tool result with no request and no `userError` | high (two sources, same frame) |
| An `ask` rule or a deny-list entry offers only `proceed_once` and `cancel` | high |
| Every `update_session_settings` gets one `settings_updated` with its `requestId`, before the response | high (8 of 8, 16 of 16 across runs) |
| An over-cap level is clamped, not rejected | medium (process overlay, not an org cap) |
| `initialize_session` swaps a blocked model without an error | medium (one account, one policy) |
| Droid's default safety list uses the same frames as the legacy lists | low (not observed) |
