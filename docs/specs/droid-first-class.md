# First-class Droid in Orca

Compiled from map [#1](https://github.com/codeious/orca/issues/1) (tickets #2 to #49) and ADRs 0001 to 0008. The ADRs hold the reasons and the rejected options. This spec holds the rules a builder needs, the ordered build slices, and the checks that cannot be automated. Where a ticket comment and an ADR disagree, the ADR wins, and section 16 lists every disagreement found.

Terms are defined in [`CONTEXT.md`](../../CONTEXT.md). This spec uses them as written: **Droid terminal session**, **Structured Droid session**, **Launch mode**, **Chat UI switch**, **Droid floor**, **Session holder**, **Fork**, **Lead session**, **Background child**, **Mission**, **Mission Control**, **Mission detail**, **Owned Mission**, **Observed Mission**, **Paused Mission**, **Interrupted Mission**, **Droid Computer**, **Remote Control machine**.

## 1. What ships

| Area                            | What Orca does                                                                                                                                                                              | Decided in           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Session core                    | Droid runs as a structured Droid session in Orca's chat, driven over `stream-jsonrpc` by Orca's own client, on hosts that can run it. The Droid terminal session stays for everything else. | ADR 0001, 0003       |
| Droid terminal sessions         | Hooks move to the user `hooks.json`. Status rows gain a process verdict, a lead/child split, and a process-confirmed exit.                                                                  | ADR 0004, 0005, 0007 |
| One writer                      | Orca allows one session holder per Droid session among the writers it can see.                                                                                                              | ADR 0007             |
| Missions                        | Orca follows and steers Missions that run in a Droid terminal session, through Mission Control. It never starts a Mission by API and never writes a Mission file.                           | ADR 0005, 0008       |
| Config UIs                      | Claude and Codex parity only. Mission Control is the one Droid-only exception.                                                                                                              | ADR 0004             |
| `droid exec` automation         | A Droid automation is a Droid terminal session. It never runs a Mission.                                                                                                                    | #46                  |
| Remote Control, Droid Computers | Ordinary SSH hosts through `droid computer ssh <name> --proxy`. Orca ships documentation, no code.                                                                                          | ADR 0006             |

Mission Control is behind the Factory App in four deliberate ways: no model dropdowns, Pause only on Droid 0.245.1 or newer, no per-worker kill, and no plan editing.

**Out of scope** (map "Out of scope", with ADR 0004, 0007, 0008):

- Orca-managed Factory accounts. Each host uses Droid's own login.
- Droid-only config UIs (hooks list, custom droids, slash commands, plugin management, user-level MCP, skill on/off) and an Orca plugin for them.
- Guarding commands typed by hand in an Orca pane. No agent's guard covers `pty:write`.
- Model pickers, per-worker kill, and plan editing in Mission Control.
- Fork into new chat, and a fork button on rows no chat owns.
- Orca-supervised `droid exec --mission`, `droid daemon`, any Factory cloud API call, and an Orca worktree per Mission or worker.

## 2. Rules that bind every slice

- **Published contracts only.** Use `stream-jsonrpc`, `@factory/droid-sdk` types, and documented flags. Undocumented formats (Mission files, `droid daemon`, `droid.change_working_directory`) are allowed only as version-gated, read-only fallbacks. Orca calls no `droid.*` Mission method.
- **Droid's own login** on each host. Orca checks no credential file and manages no account.
- **`AGENTS.md`:** SSH use case (verdicts are `live` / `unverifiable` / `exited`, and lost contact is never evidence of death), folder workspaces, remote wire compatibility, one agent-status store, captured terminal transcripts for any rule that reads a screen, `@orca/process-host` for child processes, Windows process rules.
- **Seam.** `StructuredAgentSessionAdapter` (`src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts`) and `STRUCTURED_AGENT_RUNTIME_REGISTRATIONS` (`src/main/runtime/structured-agent-runtime-registrations.ts`). Today Droid has hooks, resume, skills, and session search (`src/main/droid/hook-service.ts`).
- **Run blast-radius before changing a shared type.** Section 13 lists the types.
- **Tests cost credits.** No automated test may start a Mission. Section 15 lists what must be checked by hand.

## 3. Launch mode (ADR 0003, #10)

A per-agent launch setting decides whether a new Droid launch opens as a structured Droid session or a Droid terminal session. The global Chat UI switch is its fallback.

- **Storage.** A map in global settings keyed by agent id. Only Droid's row is shown for now.
- **Values.** _Follow Chat UI switch_ (default), _Terminal_ (beats a switch that is on), _Chat_ (beats a switch that is off).
- **Reach.** It enters through the shared launch-route policy, so the renderer tab, mobile create, CLI create, and orchestration worker all honour it.
- **Feasibility is unchanged.** SSH, WSL, a Droid below the Droid floor, a host that is not ready, a custom start directory, or a reused terminal always give a Droid terminal session. The launch receipt records why.
- **Receipt reasons.** `user_default` keeps its meaning. A sibling reason names the per-agent setting. `agent_version_unsupported` (section 5.2) covers a Droid below the floor.
- **Ignored by:** the floating terminal, explicit chat requests ("Resume in new chat"), automations (`terminalOnly`), and Start Mission.
- **Migration.** Nothing is converted. Running and sleeping Droid terminal sessions stay terminals. With the default value, only users who already have the switch on see a change: new Droid launches become structured once Droid meets the floor.
- **Open:** where the setting appears in desktop and mobile settings, and its wording (section 16).

## 4. Hosts for structured Droid sessions

A structured Droid session runs where Orca spawns `droid` itself: this computer (macOS, Linux, Windows) and a paired Orca server. WSL and SSH workspaces, including Droid Computers and Remote Control machines, get Droid terminal sessions only. A WSL launch has no structured composer, so WSL needs no learned default.

## 5. Structured Droid session (ADR 0001, 0002, 0003)

### 5.1 Transport and process

- Spawn `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc` through `@orca/process-host`. Orca supervises the process and speaks the protocol through its own JSON-RPC peer. The SDK supplies types and contract tests, never runtime code.
- The peer needs a hook for Droid's extra message fields (`type`, `factoryApiVersion`, `factoryProtocolVersion`). Droid 0.238.0 rejects the raw JSON-RPC example in Factory's docs, which omits them.
- Spawn the process with the structured-session identity variables but without `ORCA_PANE_KEY` and the `ORCA_AGENT_HOOK_*` variables (`src/main/runtime/structured-session-child-identity-env.ts`, `AGENT_HOOK_RUNTIME_ENV_KEYS`). Droid's installed hook script posts only with a port, token, and pane key (`src/main/agent-hooks/hook-stdin-contract.ts`), so Orca's hooks stay silent in a structured session and the user's own hooks still run.
- The adapter is the only status producer for a structured session (a row marked `structuredHost: 'owned'`). Hooks are the only producer for a terminal session.
- Quitting Orca ends structured sessions, as it does for the other agents.
- Never set `interactionMode: mission`. A Mission cannot start over `stream-jsonrpc`: the Mission tools are listed but the model cannot load them.

### 5.2 Detection, floor, sign-in (#18)

Orca checks Droid only where it runs a structured session, and only when a decision needs the answer.

| Host                              | Installed                                                                  | Version                                                                                                                                     | Signed in                      |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| This computer, paired Orca server | Today's PATH check plus the install-directory fallback, no new directories | `droid --version` at every create and every resume, against the Droid floor. `factoryProtocolVersion` major 1 at `droid.initialize_session` | Never checked ahead            |
| WSL, SSH                          | Today's checks                                                             | Not checked                                                                                                                                 | Droid's own terminal interface |

- **Droid floor.** 0.238.0 (ADR 0001), raised deliberately. A Droid passes when `droid --version` reports a stable release at or above the floor, on any major. Prereleases fail. Droid terminal sessions have no floor.
- **Protocol check.** `factoryProtocolVersion` must have major 1 (1.260.0 on Droid 0.239.0). It guards against breaking protocol changes. It is not a cap on the CLI's major version.
- **No cache.** The probe takes about 50 ms, so every create and resume probes again.
- **Messages.**

  | State                          | Where             | What                                                                                                                                                                                                                                                                                                                          |
  | ------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Not installed, terminal launch | Settings → Agents | Droid under "Available to install" with the docs link, pointed at Factory's current quickstart. Orca never prints an install or npm command.                                                                                                                                                                                  |
  | Not installed, chat requested  | The chat          | Existing `cliMissing`: "Droid wasn't found on the computer running this chat. Install it, or check its Command in Settings → Agents." No fallback to a terminal.                                                                                                                                                              |
  | Below the floor, new launch    | The launch        | A Droid terminal session opens. The receipt carries the new agent-neutral reason `agent_version_unsupported`: "Droid 0.230.0 is older than 0.238.0, the oldest release Orca's chat supports. Run `droid update` on this computer." CLI and mobile show receipts. Desktop shows the same sentence as a toast once per app run. |
  | Below the floor, resume        | The chat          | Refusal `structured_agent_session_unsupported` with new reason `versionUnsupported` carrying the version and the floor: "...Run `droid update` on this computer, then retry."                                                                                                                                                 |
  | Protocol major is not 1        | The chat          | The same `versionUnsupported` reason: "This Droid release isn't supported in Orca's chat yet. Open Droid in a terminal."                                                                                                                                                                                                      |
  | Signed out                     | The chat          | Existing `notSignedIn` failure. Add Droid to `src/shared/agent-session-sign-in.ts` as `droid` plus `/login`, and make `agentSessionSignInCopyId` in `src/shared/agent-session-availability.ts` pick `interactiveAgentNotSignedIn` for it, as for Pi. Droid's own error text also appears in the transcript.                   |

- **Sign-in detection.** A turn ending with `agent_turn_completed` `reason: model_authentication_failed` (preceded by an `error` notification with `errorType: AuthenticationError`) is the not-signed-in failure. Orca ends that `droid` process, and the next message resumes in a fresh process through `droid.load_session`, so a login made meanwhile takes effect. A signed-out `droid.initialize_session` still succeeds and lists models, so the model picker keeps working and the model catalog probe cannot report `notSignedIn`.
- **Not used:** `droid doctor --auth` (always exits 0, calls the network, writes under `~/.factory`, no output schema), and any credential-file presence check.
- **Windows.** `%USERPROFILE%\bin` is not added to the fallback. A hand-placed binary uses the Command setting in Settings → Agents. WSL keeps ignoring the Windows mount, because `droid.exe` has a separate login.
- **Updates.** Orca never sets `FACTORY_DROID_AUTO_UPDATE_ENABLED` outside its own tests and never runs `droid update`. A running structured session keeps the build it started with. The next create or resume probes again. No "Droid updated" notice.
- **Isolated profiles.** When `usesIsolatedProfile()` is true, every Droid process Orca starts (version probe, structured session, terminal launch environment) gets `FACTORY_DISABLE_KEYRING=1`, so Droid keeps credentials in files under the profile's `HOME` and never touches the macOS login keychain (`src/shared/electron-isolated-profile-switches.ts`).
- Pi and the ACP agents may move to the two new reasons later. Today they report `structured_unsupported_on_host` and `hostUnsupported`.

### 5.3 Models and effort (#19, #26)

- **Listing.** Call `droid.list_models` on the `stream-jsonrpc` process before any session. It returns `{ models }`, has no session id, and writes no session file. `availableModels` on `droid.initialize_session` is the same list, but initialize stores a session, so the probe must not use it.
- **Registration.** A `probe` that runs on the execution host, with `listingNamesConfiguredModel: false`, `fallbackModels: () => null`, `effortDefaultsToModel: false`, and no listed `defaultEffort`. #26 reverses #19's `effortDefaultsToModel: true`.
- **Rows.** BYOK models appear as `custom:<Display-Slug>-0` with `isCustom: true`. The id is a slug of `displayName`. Do not pass `includeDisabled`: the picker cannot mark a blocked row, so it would offer models that cannot run.
- **Why no listed effort.** Droid resolves effort as the explicit pick, then the `reasoningEffort` setting, then built-in `high`. It uses the model's `defaultReasoningEffort` only when the resolved value is not offered. The listed default is wrong for most models, and Orca does not read Droid's settings files (layers: org, runtime `--settings`, folder, project, user, with `settings.local.json` over each; the org layer is not always readable, and SSH reads would cross the relay).
- **Composer display** (shared rule in `src/shared/structured-agent-session-options.ts`, no Droid wording):
  1. Before the host answers: a quiet "Model" pill that cannot be set.
  2. When the list arrives: models can be picked and no value shows.
  3. After a no-pick Droid session has run: the pill shows that session's model and effort (the learned default). Every no-pick session records it again, and a session that resolves to a model outside the list retires it. Each execution host and account learns its own.
  4. Once the chat's own session answers `agentSession.options`, its value shows and later host answers do not replace it.
- **No effort shows** for any model until the user picks one or a session reports it.
- **Project override layer.** Add a `droid` entry to `PROJECT_MODEL_LAYERS` in `src/main/native-chat/agent-model-catalog/agent-project-model-override.ts`. A workspace overrides when any of `.factory/settings.json` or `.factory/settings.local.json` sets `model`, `reasoningEffort`, or either inside `sessionDefaultSettings`, or cannot be read. In a git repository (linked worktrees included) Droid reads `.factory` in every folder from the git top-level down to the chat's folder, and the deepest wins. In a folder that is not a git repository, only the chat's own folder counts. `~/.factory` is account config, not a layer. An agent missing from the table counts as "may override anywhere", so Droid would learn nothing.
- **Creating a chat starts no Droid process and stores no session file.** The adapter calls `droid.initialize_session` when the first prompt starts the session (`src/main/native-chat/agent-session-wire/structured-agent-session-host.ts` already starts an agent only for work that needs one).
- **Org-swapped model.** `droid.initialize_session` can succeed with a different `modelId` than requested (an org blocking every built-in model did this), while `droid.update_session_settings` returns `-32603`. The adapter compares the returned `modelId` with the one it asked for. The pill follows the model Droid reports, and that model replaces the saved pick. No transcript notice, since one needs capability negotiation with older clients.
- **Spec model and effort.** While Spec is on, the pickers read and write `specModeModelId` and `specModeReasoningEffort`. When those are empty, they show the main model.

### 5.4 Modes and autonomy (#9, ADR 0002)

| Orca control                                           | Droid setting                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Agent Permissions **Yolo** (also an untouched setting) | `autonomyLevel: high`                                                                                           |
| Agent Permissions **Manual**                           | `autonomyLevel: off`                                                                                            |
| Edited Droid launch arguments                          | `--auto <level>` read from the arguments; `--skip-permissions-unsafe` counts as `high`; no `--auto` means `off` |
| Spec toggle on (`planMode: true`, labelled "Spec")     | `interactionMode: spec`                                                                                         |
| Spec toggle off                                        | `interactionMode: auto`                                                                                         |
| Never used                                             | `skipPermissionsUnsafe`, the `--auto` flag over `stream-jsonrpc` (validated only), `interactionMode: mission`   |
| Droid terminal session                                 | Unchanged: Yolo launches `--auto high`, Manual passes no flag                                                   |

- Today Orca treats any Droid argument string other than the exact `--auto high` as Manual. Structured sessions read the level from the arguments, so terminal and structured sessions agree.
- **`planMode`** is a new optional boolean session option, encoded like `fastMode`. The adapter translates it to `interactionMode` and reports it back from `settings_updated`. The toggle shows only when the host reports the field. The pick is saved like a model pick, so a session at rest in Spec resumes in Spec. On plan approval Droid leaves Spec and the toggle follows `settings_updated`. The key name is fixed, because renaming it later means carrying two names across mixed-version peers.
- **On every start or resume,** send `autonomyLevel` from the setting and `interactionMode` from the saved Spec pick explicitly. Never inherit the level Droid saved in the session. A change to Agent Permissions takes effect at the next start.
- **Org cap.** Droid clamps silently: `droid.initialize_session` and `droid.update_session_settings` both succeed, and the only signal is the level in `settings_updated` plus a shorter `availableAutonomyLevels`. Orca accepts the level Droid reports and shows a one-line chat notice when it is lower than the setting asked for. An invalid level is accepted and ignored.
- **`settings_updated`.** Every `droid.update_session_settings` gets exactly one, with `requestId` equal to the request id, before the empty `result: {}`. A valid level or mode also produces an unsolicited one with no `requestId`, and some of those are partial, so the adapter merges. Read `autonomyLevel` and `interactionMode`, not the legacy `autonomyMode` (it reads `spec` at every level in Spec mode).

### 5.5 Approvals, questions, blocks (#9, #21)

Droid enforces approvals (`approvalEnforcement: provider`). Orca never answers for the user. Every `droid.request_permission` and `droid.ask_user` goes to the user, including under Yolo, where `ask` rules, sandbox violations, and Droid Shield violations still prompt.

- **Approval card.** Show every option Droid offers: Droid's `label` as the label, its `value` as the option id. Options that raise the level are how the level changes mid-session. Orca adds no autonomy picker. A raise lasts only while that Droid process runs. "Always allow" options make Droid write its own settings files, and Orca does not touch those writes.
- **Observed options.** `exec` and `apply_patch` at `off`: `proceed_once`, `proceed_always`, `cancel`. An `ask` rule or legacy `commandDenylist` entry at `high`: `proceed_once` and `cancel` only, with `impactLevel: high` and a `riskLevelReason`. After the answer come `permission_resolved` (`requestId`, `toolUseIds`, `selectedOption`) and the tool run.
- **Spec plan approval.** `exit_spec_mode` becomes an approval item with the `plan` subject (`text` is Droid's `plan`), drawn as the existing "Review proposed plan" card. Offer proceed and the auto-run options. Hide `proceed_new_session*` (Orca would need to follow a new session id) and `proceed_edit` (needs a plan editor). Reject and dismiss both send `cancel`: the turn ends, the session stays in Spec, and the user gives feedback as a normal message. Older clients still answer plan approvals, because `plan` is a subject they already draw.
- **Block.** A command matching a `block` rule (or the legacy `commandBlocklist`) gives a plain failed `tool_result` (`isError: true`) with text addressed to the model, and no permission request. The expected `userError` field appears in no frame, so show the text as output and do not parse it. Sandbox and Droid Shield violations arrive as permission requests, so they are approval cards that show the reason and the blocked target.
- **Fixtures** are on `research/droid-approval-frames` (nine scrubbed logs). Copy the ones a test uses into the repository.

### 5.6 Steering (#20, #27)

- Keep `steering: 'inject'`. Mid-turn messages go as `droid.add_user_message` with `queuePlacement: end_of_turn`. Never send `end_of_loop` and do not ship `queue`.
- An `end_of_turn` message lands between tool calls (4 ms after the running tool's `tool_result` in the fixture), never cancels the running tool, and is not lost if sent while the final answer streams. Droid delivers it and the model decides whether to obey.
- Nothing says "queued". Match frames by request id:

  | State     | What the person sees                                                                                                | Journal state                                                                                          | Droid frame                                                                                                                              |
  | --------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | Pending   | A plain bubble in the running turn                                                                                  | dispatch `pending`                                                                                     | The `droid.add_user_message` reply (`result: {}`), receipt only                                                                          |
  | Delivered | The same bubble, confirmed                                                                                          | dispatch `accepted`, provider item id is the echo's message id                                         | `create_message` with role `user` and `requestId` equal to the send's JSON-RPC id (skip the empty `visibility: llm_only` rows beside it) |
  | Discarded | The bubble leaves its turn and sits where the rejection happened, then a "Stopped manually" row. No failure notice. | dispatch `rejected`, reason `provider_cancelled_before_start`, kind `cancelled` (category `withdrawn`) | `queued_messages_discarded` with `requestId` equal to the send's id                                                                      |

- A discard settles the send at once. It does not wait for `agent_turn_completed` with reason `cancelled`, which follows about 50 ms later.
- Nothing is restored to the composer. Only the person can resend. The frame's own `text` is ignored.
- A turn that ends, or a process that exits, while a steer has neither echo nor discard leaves the send `unknown`. Reconcile it against the transcript on the next load. Never mark it `rejected`.
- A discard for an unknown or already settled request id is logged and dropped. The first settlement wins and `rejected` is terminal.
- Key tool frames by tool id: `tool_call` repeats per tool, and an interrupted tool sends two `tool_result` frames.
- Existing rule and tests: `src/shared/structured-agent-session-dispatch-rejection.ts`, `src/renderer/src/components/native-chat/structured-agent-session-send-runtime.ts`, `src/renderer/src/components/native-chat/native-chat-stopped-before-start-row.ts`. The adapter test uses `end-of-turn-interrupt.jsonl` from `research/droid-steering-placement`.

### 5.7 Status and search

- One row per Droid session in the AI vault. A structured session is marked chat-owned and not listed twice, by widening the `claude`/`codex`-only join in `src/main/ai-vault/structured-session-ownership.ts` to include Droid. Droid is already scanned from its own transcripts, so no second index is needed. Sessions on SSH or WSL stay terminal rows.
- The vault stops counting records with `visibility` `llm_only` or `user_only`, and `completion` lines, as messages (`src/main/ai-vault/session-scanner-droid-parser.ts`). A session whose only records are hidden ones, such as a failed sign-in with nothing typed, is then empty and cannot be resumed. A prompt the user typed still counts as a message, so a signed-out session that received one is not empty.

## 6. Droid terminal session: hooks and status row (ADR 0004, 0005, 0007)

### 6.1 Hook installation (ADR 0004, #14, #16, #22)

Facts on Droid 0.238.0 and 0.240.0: within one settings level Droid loads the `settings.json` `hooks` key and `hooks.json` and merges them per event, with `hooks.json` replacing that event. Levels (org, user, project) add together. A `/hooks` save writes the whole merged set to the level's `hooks.json` (without `PermissionRequest`) and leaves the `settings.json` key untouched. Its enable toggle writes a top-level `hooksDisabled` into `hooks.json`. Only org `allowManagedHooksOnly: true` and `hooks.hooksDisabled: true` silence Orca's hooks wholesale. The hook event enum has no `PermissionRequest`.

Orca does this:

- **Install into the user `hooks.json`,** written the way a `/hooks` save writes it (top-level keys are event names, no `hooks` wrapper), identified by the managed script path. First carry the level's existing `settings.json` hook entries into `hooks.json` so none is shadowed, then add Orca's entries.
- **Writer.** Droid-only and key-level. Re-read the file right before writing, change only Orca's entries, leave `hooksDisabled` and any other non-event key alone, write atomically with a backup, skip the write when nothing changed.
- **Migrate out of `settings.json`.** Remove Orca's old entries from the `settings.json` `hooks` key with a key-level edit that keeps `disabledSkills`, `enabledPlugins`, `permissionRules`, and every other key. Because Droid's own `/hooks` save was observed to leave that key in place (#22), Orca removes only its own entries and does not clear the key.
- **Drop `PermissionRequest`** from the installer and delete its dead branches in `src/shared/agent-hook-listener/providers/droid-events.ts` and `droid-tool-fields.ts`.
- **Status check.** Read what Droid loads: both files at user level, `hooks.hooksDisabled` in both, and the organization's `allowManagedHooksOnly`. Resolve each Orca event separately, taking the file Droid loads for that event, and read a set with any event shadowed or missing as not installed, so the installer repairs it. This replaces today's check of top-level `settings.json` keys, which Droid ignores.
- **Entries show in `/hooks`.** If a user deletes them, Orca reinstalls them.
- **Hosts.** Local, SSH, and WSL installs keep sharing one mutation, so all three write the same `hooks.json` tree. Changes apply to new Droid sessions.
- **Fix the wrong comment** in `droid-events.ts` that says the approval path sends no `Notification` (#22).
- **Skill installer is unchanged.** It never writes `disabledSkills`.

### 6.2 Approval signals (#22)

For approvals at autonomy `off`, Droid fires `SessionStart`, `UserPromptSubmit`, `PreToolUse`, then a `Notification` 29 to 69 ms later with `notification_type: "permission_prompt"` and the message `Factory CLI needs permission to execute 1 tool(s)`. Orca's `waiting` already comes from `PreToolUse` (AskUser, or `riskLevel: high`) and that `Notification`. `riskLevel` is on commands only, not on `ApplyPatch`. How `waiting` clears, high-risk commands, AskUser, and Spec plan approval were not observed (section 15).

### 6.3 Process identity and verdict (ADR 0007, #31)

- Droid hooks capture the `droid` pid and start time as Claude's do: run the capture in the hook's command shell (as Claude's `ORCA_HOOK_AGENT_PID="${PPID:-}"` prefix does), because the chain is `script sh <- command sh <- droid <- launcher`. In the script's own shell `$PPID` is the command shell. Matched 61 of 61 hooks on macOS and Linux, on 0.238.0 and 0.244.0.
- The capture lives in `src/main/agent-hooks/hook-process-capture.ts` and the normalizer in `src/shared/agent-hook-listener.ts` (`source === 'claude'` only today). Extending it touches code shared by the main, relay, and WSL-guest listeners. Run blast-radius first.
- Until a terminal has an identity (native Windows, rows saved before the capture), its verdict is `unverifiable`. Droid hooks also feed `checkAgentPresence`, which returns `null` for a row with no identity.
- The identity is stable across events and `/new`. A resume in a new process is a new pid and start time with the same session id.

### 6.4 Exit rule (ADR 0007, #33, #39, #44)

A Droid `SessionEnd` never ends a terminal's process by itself. `reason=other` marks a real exit and also the old session's late event after `/new`, `/tree`, and `/resume <id>`, and arrival order cannot tell them apart (with a `SessionStart` hook slower than about 10 s, Droid stops waiting and the old `other` arrives first, 124 of 124 switches).

- A `SessionEnd` of any `reason` that carries the row's owner-process identity and names the pane's current lead starts one watch per row on the host that owns the process.
- The watch probes the captured pid and start time at 0.25 s, then at doubling gaps up to 8 s, for about 90 s (Droid's default hook timeout is 60 s, and `droid` is still alive when the post lands at Ctrl-C and SIGTERM). It marks the row ended only when the probe returns `exited`. It stops early on any later hook from the same process, a lead change, or a cleared row. At the bound it leaves the row as it was, and the on-demand check (Resume, another process's hook) stays authoritative. The numbers are defaults to tune.
- Every other `SessionEnd` is dropped: a child's, and one for a session that is not the lead. The reason is not read. Claude's `agent_id` filter cannot serve, because Droid's child `SessionEnd` has none.
- A hook after the row is ended, from the same process, stays ignored with no revival. A new `droid` has a new identity and becomes a fresh owner.
- Without a captured identity a `SessionEnd` changes nothing and the verdict stays `unverifiable`.
- The watch runs where the process runs and reports the same `ended` presence Claude's exit does, so it needs no wire capability. Local and managed hosts use the in-process check, a WSL distro its guest's presence path. A host with no host-side check, such as a relay that predates this rule, forwards `other` as an ordinary status update and its SSH rows stay `unverifiable`.

### 6.5 Lead and child sessions (ADR 0005, #30, #32, #33, #37, #44)

One pane has one **lead session**, which owns the row. Everything else is a child that feeds the row's flat `subagents` list.

**Lead**

- The lead is the session of the pane's latest `SessionStart` with no `calling_session_id`, taken only from a hook of the row's owner process.
- A start from the owner process that names the lead's own id is a repeat and a full no-op: not the row, the pane's prompt and tool cache, the child snapshots, the finished-child marks, or `restoredUnconfirmed`. Exception: on a row with no captured identity, a start naming the lead's own id replaces the lead, because a relaunched `droid --resume <id>` sends the same payload as `/resume <current id>`. The cost is that `/resume <current id>` there drops a live Mission's worker snapshots for good.
- A start with no `calling_session_id` that names a different id (`/new`, `/clear`, `/tree`, `/resume <id>`, a resume) replaces the lead, drops the old lead's children and caches. A process exit clears the lead. There is no mid-turn guard: every plain `Task` subagent start carries `calling_session_id`, foreground and background.
- After a restart the lead is seeded from the restored row's resume identity. With none, the first session seen is a provisional lead, and a `calling_session_id` naming another session repoints it to the root of its chain. Once a lead is known, an unseen session without a parent is not adopted.
- A hook from any other process (a `droid exec` the lead runs, or a relaunched `droid` whose predecessor's exit was not seen) never chooses or replaces the lead. It triggers the owner check. Once the owner is proven `exited`, the next event from the new process starts a fresh provisional lead.
- A missing `SessionStart` costs nothing: the lead's start makes no row, and every hook carries the session id and process identity.
- Only the lead's events set the row's state, prompt, tool, and resume identity.

**Children** (Mission workers, validators, `Task` subagents, one code path)

- A start naming a `calling_session_id` records the child id and parent and creates no snapshot. Repeats change nothing.
- `UserPromptSubmit`, `PreToolUse`, `PostToolUse` mean `working`. A `permission_prompt` `Notification` means `waiting`. A child's `PreToolUse` never means `waiting`, because workers run at `auto-high` and do not ask.
- `Stop`, or the child's own `SessionEnd`, removes the snapshot and marks the id finished. A later start naming a `calling_session_id` for a finished id is ignored. A start with none that names a finished id replaces the lead like any other new id.
- A child's `idle_prompt` `Notification` removes its snapshot without marking it finished, and its next prompt or tool event brings it back (this is how an Esc pause reads).
- Dropped: `SubagentStop` (carries the lead's id), other child `Notification`s.
- Droid 0.238.0 child fires no `SessionEnd`. Droid 0.244.0 child fires a second `SessionStart` and a `SessionEnd reason=other` after its `Stop`. Neither touches the process verdict.
- Naming: each child snapshot gets `agentType: 'droid'` and `description: 'Droid agent <first 8 characters of the session id>'`. No row says Worker, Validator, or Subagent, because hooks cannot tell them apart.
- Snapshots are flat siblings. The parent link stays in the listener. Nesting a validator's subagents is deferred as an optional field.

**The row during a Mission**

- The lead sends no event during a run, so the row shows `working` on `StartMissionRun` for the whole run.
- The row is `done` only after the lead's own `Stop` or idle `Notification`, and never while a child is `working`. A `waiting` child outranks a `working` lead.
- A lead idle `Notification` (Droid's signal after a user interrupt) drops the children that were running in the lead's open turn. A lead `Stop` keeps them. A background child that outlived a `Stop` survives a later idle `Notification`.
- When a background child's `Stop` leaves no child working while the lead is stopped, the row stays `working` until the lead's next hook or 10 s, whichever is first (one 0.6 s observation).
- A child that ends with neither `Stop` nor `SessionEnd` holds the row `working` until the lead exits or is replaced.
- After an Esc pause: lead `Stop`, child `idle_prompt`, so the row reads plain `done`. No interrupted verdict.

**Where child rows appear:** sidebar and dashboard rows (`buildSubagentChildRows` into the shared child-row model) list running children only. The dashboard pop-out reads the same snapshots. Over SSH the existing rule stands: a live child under a parent Orca no longer hears from reads "No recent update". `worktree ps` and the mobile worktree list carry no child rows, for any agent.

## 7. One writer per Droid session (ADR 0007, #23, #28, #29, #47, #49)

Droid takes no lock. A second process loads a held session without error and appends to the same file, two writers split the history into two chains, and an idle terminal never shows the other writer's messages. So Orca enforces one session holder itself, among the writers it can see: its own terminal panes (through their status rows) and its own chats.

**Outside the guarantee:** a Droid in the user's own terminal, `droid exec -s`, the Factory App, and a command typed by hand in an Orca pane.

**Holder rule.** A terminal holds session X while a pane row carries X and its `droid` process is not proven `exited`, whether the agent is working, idle, or `done`. A row alone is not proof, because Orca keeps a dismissed row's session id for resume.

| Terminal verdict                       | Resume in new chat                                       |
| -------------------------------------- | -------------------------------------------------------- |
| `live`                                 | Not offered. The row offers "Open terminal".             |
| `unverifiable`, or no process identity | Offered after a confirmation that the history may split. |
| `exited`                               | Offered normally.                                        |

**Resume in new chat eligibility** (its own Droid branch; today Droid is refused because it is not a provider-handle agent, and the check has no live-terminal reason): local only (section 4), a non-empty session, the workspace path equal to the recorded folder, and no live holder. A held session gets its own blocked reason. A folder mismatch or a deleted recorded folder uses the existing `workspace` reason.

**Adapter rules.**

- Load with `droid.load_session` only. It works from any folder and writes nothing. On 0.238.0 and 0.249.0 its reply names no session id (the adapter keeps the id it sent; `droid.initialize_session` replies with a `session` that has no `id` either) and reports the folder in `result.cwd`. Compare that folder with the workspace, both resolved to real paths, and close the process on a mismatch. When the recorded folder no longer exists, `result.cwd` is the loader's folder, so a deleted folder is invisible there; read it from the vault's recorded `session_start.cwd`.
- Never call `droid.initialize_session` with an existing id (it writes a second file with the same id under the new folder). Never call `droid.change_working_directory` (not a published contract, needs a trusted folder, and the change lives in Droid's session index where the vault cannot see it).
- A loaded session's tools run in the folder it was recorded in, whichever folder the loading process, `droid --resume`, or `droid --fork` started in.
- The adapter reports its Droid session id as a provider handle (agent `droid`) and joins the shared ownership list.

**Guard grammar.** The vault lookup, `findOwnership`, `findResumeOwnership`, and the resume parser become a per-provider table (`src/main/ai-vault/structured-session-ownership.ts`). Run blast-radius first. For Droid:

- Refused while a chat owns the id: `-r <id>`, `--resume <id>`, `droid resume <id>`, `droid exec -s <id>`, `droid exec --session-id <id>`.
- Treated as target-less and refused while any Droid chat is live: `--resume` with no id, `--last`, `droid resume` with no id, a session link as the target.
- Always allowed: `--fork`.
- Flags were read from `droid --help`, `droid resume --help`, and `droid exec --help` on 0.244.0, then re-checked on 0.238.0 and 0.249.0: the grammar is the same. Inside `droid exec`, `-r` is the reasoning effort, not resume, so only the root command reads it as resume.

**Host query.** The host needs a query that joins a session id to the pane rows holding it and to each pane's verdict. Nothing does that today. It runs where the transcript lives.

**Moving between surfaces.**

- Terminal to chat: Resume in new chat, only when nobody holds the session.
- Chat to terminal: "Resume in New CLI" runs `['droid', '--fork', id]` (`getAgentForkArgv` in `src/shared/agent-resume-argv.ts` returns `null` for Droid today). It is offered on chat-owned Droid rows only, as for Claude and Codex. A terminal resume of a chat-owned session is refused.
- A row a live terminal holds gets no fork button. It keeps Open terminal, and branching it is `droid --fork <id>` typed in a terminal. That command needs no prompt and restores the session's recorded folder (0.238.0, 0.249.0).
- There is no Fork into new chat. A chat fork would load a held session on purpose, and the folder case needs the rejected `droid.change_working_directory`, which leaves the fork's `session_start.cwd` on the old folder where the vault reads it. `droid exec --fork` is refused over `stream-jsonrpc`.
- A chat-owned Droid row shows the chat's title and link in the vault.

## 8. Missions (ADR 0005, 0008)

### 8.1 Ownership

- **Owned Mission.** It runs in a Droid terminal session in an Orca pane, however it was started (Start Mission or `/missions` typed by hand). The terminal owner that already exists on that host keeps it alive: the terminal daemon for local and WSL, the relay for SSH, `orcad` on managed hosts. Orca adds no supervisor and does not use `droid daemon`. On Droid 0.238.0 and 0.242.1 the TUI `droid` runs every worker and validator inside its own process, creates no worktree, and commits on the working directory's current branch. Ownership follows where the Mission runs now: one resumed in the Factory App becomes observed.
- **Observed Mission.** One Orca finds on a host but does not run (Factory App, `droid daemon`, a terminal outside Orca). Read-only through the file reader, never steered, `unverifiable` until Droid says it is completed, absent from the status store.
- **Linking.** A terminal links to its Mission through the lead session id and the `mission-session` tag in the session's `.settings.json` (`{name: "mission-session", metadata: {role: "orchestrator" | "worker", missionId}}`). The Mission id equals the orchestrator's session id on Droid 0.242.1; the tag is the check. Never link by working directory. A Mission Orca cannot link is observed. (`decompMissionId` is not on disk on 0.242.1.)
- **No worktrees.** Orca creates none for a Mission or a worker. For isolation the user starts the Mission in a new Orca worktree. Droid's `-w` checkouts stay external worktrees in the inbox. Orca never deletes Droid's checkouts, branches, Mission directories, or sessions.
- **Folder workspaces** are allowed. Ownership and status are keyed by workspace and execution host, and nothing assumes git. If Droid refuses a Mission outside git, show Droid's message. The floating terminal has no start action, and a Mission started there by hand is owned and shows with no workspace.

### 8.2 Three layers of state

| Layer    | Source                                                                  | Decides                                                                                    |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Liveness | The terminal's `live` / `unverifiable` / `exited` verdict (section 6.3) | Whether the Mission is alive                                                               |
| Activity | Hooks in the agent-status store (section 6.5)                           | Row state, phase from the lead's open tool: `AskUser`, `ProposeMission`, `StartMissionRun` |
| Detail   | Droid's Mission files, read on the execution host                       | Features, milestones, progress log, handoffs, models, pause reason when present            |

- The files never say a Mission is running or exited. A `running` file with a terminal that is not `live` reads **Interrupted**.
- Workers and validators are `exited` when the terminal is proven `exited` only if the host's Droid is at or above the Droid floor. Otherwise they stay `unverifiable`.
- The typed `mission_*` notifications exist only in the process hosting the Mission, so hooks are the published signal. A structured Droid session loaded on the orchestrator would be a second writer.
- The reader is read-only, gated on the Droid floor, and tolerant of unknown fields (ignored) and unknown values (shown raw). File shapes were observed on 0.238.0 and 0.242.1.
- Where it runs: app main or `orcad` for local, inside the distro through the WSL relay, in the relay or `orcad` for SSH. Desktop never reads remote Mission files.
- Orca adds no stuck detector (Droid defines stuck only as its pause reasons) and no notification kind. It shows the time since the last progress entry and the last hook event. `waiting` and `done` already cover notifications.

### 8.3 Mission detail stream (#42)

- **Capability.** The host lists `droid-mission.detail.v1` in `RUNTIME_CAPABILITIES`. There is no client capability. A breaking change gets `.v2`, and a host may list both.
- **Method.** Streaming `droidMission.subscribeDetail`, permission `workspace`, one stream per terminal. A client opens it only while a Mission card, sheet, or panel is visible and only when the host lists the capability. Web and mobile share one client-capability list, so both use it.
- **Cadence.** A full snapshot on subscribe, then a full replacement snapshot when something changed, at most once a second. No deltas, no client polling.
- **Content (raw file facts only).** Mission id and title, raw state and pause reason; milestones; features (raw status, attempts, worker session ids); every worker and validator the files know, running and finished (session id, kind, feature id, model, start and end time, success state, handoff; no liveness); models; optional `droidVersion`; `startedAt`, `updatedAt`; the progress log. Not carried: verdict, banner, actions, state label, dot color, lead tool, phase, last hook, credits. Plain `Task` subagents stay in the store only.
- **Caps.** Sized from Mission files up to 434 KB, 15.6 KB per log line, 17.5 KB per handoff. Log: last 20 entries, `text` clipped to 400 characters, `clipped: true` when cut. Handoff: summary clipped to 1,000 characters, first 5 discovered issues clipped to 300 characters each. Titles clipped to 200. Total at most 256 KiB serialized. Over budget, drop handoffs of the oldest finished workers first, then halve the log, then drop detail of finished workers beyond the latest 10 (keep session id, feature id, success state). State, milestones, and features are never dropped. Set `trimmed: true` and name the cut parts.
- **Snapshot kinds.** The stream never errors for a missing or unreadable Mission. Each snapshot is `none` (no Mission linked), `unavailable` (`reason` is `below_floor`, `files_unreadable`, `unparseable`, or `reader_missing`, plus `droidVersion` for "Mission detail unavailable on Droid x.y.z"), or `mission` (a Mission in planning has only `state.json` and is a `mission` with empty plan arrays).
- **One shared function** in `src/shared` derives Interrupted, Paused, the banner, and the offered actions from the snapshot, the status row, and the verdict. Desktop, web, and mobile import it. A store row with no matching worker entry shows its session id.
- **Worker liveness, one rule on every client:** the Mission's raw state is `running`, the terminal's verdict is not `exited`, and the worker has started with no end time. Hook snapshots never decide it.
- **Elapsed time** is computed by clients from `startedAt` and `updatedAt`. Credits are open (section 16).
- **Older and newer peers.** New fields are additive. An old host (no capability) with a new client shows rows only. A new host with an old client changes nothing, because the old client never opens the stream. How the reader notices file changes is open (section 16).

### 8.4 Mission Control surfaces (#13, prototype `prototype/droid-mission-control`)

**Desktop and web: a right-sidebar panel** opened from the activity bar, beside the Droid terminal. From top to bottom:

1. Header: title, state badge (Planning, Plan ready, Running, Paused, Interrupted, Completed, Last known: running, Running elsewhere), and the verdict chip with the host (for example "Local · live").
2. Banner, only for states that need you: Droid is asking you, plan waiting for approval, paused at a limit, interrupted, can't confirm it is still running, started in the Factory App, Mission detail unavailable.
3. Progress line: milestone n of m with its name, features done of total, a bar.
4. Steering (section 8.5).
5. Plan: milestones with features nested; status dot; "try n" after the first attempt.
6. Workers: running first with their subagents nested, then finished (latest three, then "N more finished"). Selecting a worker shows read-only detail: feature, status, model, started, ended, result, session, and "Load transcript tail" (desktop only, on demand).
7. Progress: the last few log entries.
8. Facts and models: elapsed time, last progress, last hook, orchestrator/worker/validator models, read-only. (Models come from `model-settings.json` and each `worker_started`; the orchestrator's when its session record carries it. They change in Droid's `/missions` settings and `/model`.)

When Orca cannot read Mission files (below the floor, or a host without the capability), the panel keeps the "Mission detail unavailable on Droid x.y.z" banner, the steering controls, worker rows labelled by session id, and the facts. Plan and progress are hidden. With no Mission linked, it shows an empty state with Start Mission on desktop.

**Mobile: a Mission card on the session screen** between the terminal chips and the terminal (title, state, banner title, progress line, current worker, Details). Details opens a sheet with four tabs: Overview (banner, progress, facts), Plan, Workers (read-only worker detail), Log. The sheet has Send message, Open terminal, and the state's resume action. No new route, no change to the worktree list. Without Mission detail, mobile shows the lead row and the "unavailable" banner, with no worker rows.

Rejected: a workspace tab, a strip on the terminal pane, a separate mobile screen.

### 8.5 Controls

Orca writes no Mission file and calls no `droid.*` Mission method. Every control is text or a key to the pane's terminal through the existing `terminal.send`.

- **Start Mission (desktop only).** Opens a new Droid terminal session in the workspace in terminal mode (whatever the Chat UI switch or launch setting says), launching `droid "/missions"`. That runs the slash command with no model call and opens Droid's Missions picker with "Begin new mission" focused (checked on 0.238.0, 0.245.0, 0.247.0). Orca focuses the new terminal and sends no keys. The user presses Enter on the row and answers any "Trust this folder?" or first-run credit panel in Droid. No `preflightTrust` for Droid. The empty-state button carries one hint line and no confirm dialog: "Opens Droid's Missions menu in a new terminal. Missions can use significantly more credits than a regular Droid session."
- **Waiting variant.** No Mission exists until the `mission-session` tag appears. For the terminal Start Mission launched, the empty state reads "Waiting for you in the terminal", the main button is Open terminal, Start Mission is hidden, no spinner, no timeout. It ends at the first of: the tag appears, the row shows a turn with no tag, or the terminal exits. Desktop renderer only; a reload falls back to the plain empty state.
- **Send message.** Types text and Enter into the pane. While the lead row is `working` on `StartMissionRun`, Enter queues the message under Droid's "Steering messages" and it reaches the orchestrator only when the run returns (118 s in the one run). The control then says "Droid reads this when the current run ends. Pause to stop the run first." Never send Ctrl+Enter. While Droid asks a question or waits for plan approval, the main button reads "Answer in terminal" or "Review plan in terminal". Observed Missions and `unverifiable` terminals get no Send message.
- **Pause.** One Esc (`\x1b`) in one write, no Enter, no status guard, never Ctrl+C (one press only arms an exit, two exit `droid` and stop the whole Mission). No confirm dialog, since Continue resumes the same worker session. Offered only when all hold: owned Mission, terminal `live`, the lead row's open tool is `StartMissionRun`, and the host's Droid is a stable release at or above 0.245.1 (from the snapshot's `droidVersion`). Everywhere else the hint "Pause is in the terminal" stays (`AskUser`, `ProposeMission`, the orchestrator's own turn, `unverifiable` and `exited` terminals, observed Missions, a host without the capability, an older Droid). The button stays disabled until the Mission reads paused, with a short timeout. The gate is separate from the Droid floor.
- **After a pause.** Banner "Droid is waiting for you. Send a message to continue." Send message opens pre-filled with "Continue the mission.", editable and unsent, because sending spends credits. A user pause records no reason, so no cause is named. A reason line appears only when `mission_paused` carries a `pauseReason`. The copy promises no redirect.
- **Resume.** `live`: focus the terminal. After an interruption (`exited` or completed): open `droid --resume <orchestrator id>` in a new Droid terminal session on the Mission's own host, in the workspace matching its working directory, and leave "Continue the mission." unsent (Droid reconciles stale files to `paused` on load). `unverifiable`, or observed and not finished: ask first ("may still be running elsewhere"). No matching workspace: offer to add the directory. Directory gone: Resume is unavailable, and Orca says why.

### 8.6 States and failure cases

| Case                                                                                                                           | Mission Control shows                                                                 | Offered                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Feature retry limit, or orchestrator or validation iteration limit (`mission_paused` with `pauseReason`)                       | "Paused", the reason in plain words, the feature it names                             | Send message, focus terminal. No retry button. Orca never edits `featureRetryBudgetBonus`. |
| Worker failed or partial (`worker_failed` with `failureReason`; `worker_completed` with `successState` `partial` or `failure`) | The feature as failed or partial, Droid's reason raw, the handoff's discovered issues | Open the worker detail                                                                     |
| Files `running`, terminal's `droid` proven `exited`                                                                            | **Interrupted**, resumable                                                            | Resume                                                                                     |
| Files `paused`, terminal `exited` (after two quick Ctrl+C)                                                                     | "Paused", "Droid exited. Resume to continue"                                          | Resume (not Interrupted, which needs files saying `running`)                               |
| Verdict `unverifiable` (SSH dropped, WSL unreachable, Windows row, restored row)                                               | Last known state with its age, "can't confirm it is still running"                    | Resume asks first. No Send message.                                                        |
| Files unreadable or Droid below the floor                                                                                      | Terminal and worker rows only, "Mission detail unavailable on Droid x.y.z"            | Controls unchanged                                                                         |
| Observed Mission                                                                                                               | Read-only, `unverifiable` until Droid says completed                                  | "Resume here…" with confirmation. No Send message box.                                     |
| Waiting on the user (`AskUser`, `ProposeMission`)                                                                              | "Droid is asking you" or "Plan waiting for your approval"                             | Focus terminal                                                                             |

A Mission is `done` in the row once the lead has stopped with no working child and the files say `completed`. A pause at a limit also reads `done`; Mission Control carries the reason.

### 8.7 Worker rows (#43)

- Rows are built from hooks alone. The status store never holds a Mission name, and no row may depend on the detail stream. Feature names and kinds appear only in Mission Control, joined by session id. Mission Control without Mission files shows the same "Droid agent <8 chars>" text (the prototype's feature-named sidebar rows are overruled).
- Child rows reach desktop and the web client only. Mobile's workers come from the detail stream alone.

### 8.8 Lifecycle (#12)

- A normal quit or update install leaves an owned Mission running, with no prompt. On restart Orca reattaches the terminal and rereads the Mission. If the terminal died while Orca was closed, the daemon's exit record makes it `exited`, which shows as Interrupted and resumable.
- A dropped SSH connection or unreachable WSL distro makes the Mission `unverifiable`. Reconnecting resolves it through the relay's terminal list.
- Closing the terminal, tab, or workspace, or putting the terminal to sleep by hand, asks for confirmation while the owned Mission is in progress (any state except paused or completed). Automatic sleep never picks that terminal.
- Removing a workspace warns but never blocks: when an in-progress owned Mission would stop, or when an unfinished Mission records that directory and could not be resumed afterwards. Every client reads the same host fact.

## 9. Config UIs (ADR 0004, #14)

| Surface                                                                                  | Source of truth                                 | What Orca does                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orca's status hooks                                                                      | User `hooks.json`                               | Section 6.1. No hooks list UI.                                                                                                                                                                                   |
| MCP servers                                                                              | Project `.factory/mcp.json`                     | Joins the repository MCP section: lists servers, opens the file in Orca's editor. Add it to `MCP_CONFIG_CANDIDATES` and `McpConfigFormat` in `src/shared/mcp-config.ts`. No user-level UI, as for Claude.        |
| Skills                                                                                   | `.factory/skills` trees and Droid plugin skills | The Skills page installs into `.factory/skills` as today and shows Droid plugin skills read-only, a sibling of `src/main/skills/claude-plugin-skill-sources.ts` and its WSL variant. No `disabledSkills` switch. |
| Plugins, custom droids, slash commands, user-level MCP, permission rules, other settings | Droid's own files                               | No Orca UI. Users use `/plugins`, `/droids`, `/commands`, `/mcp`, `/hooks`, `/skills`, `/settings`.                                                                                                              |

Config is read and written on the workspace's own host through the paths that exist today. Desktop only. Changes apply to new Droid sessions.

## 10. Automation (#46, #48)

- A Droid automation launches a Droid terminal session with the prompt on the command line, watched from the pane like every other agent (`executeAgentLaunch` with `terminalOnly: true`, `src/main/automations/headless-automation-agent-launch.ts`). The Chat UI switch and the launch setting are ignored. `droid exec` stays only the `stream-jsonrpc` transport.
- **No `droid exec` run kind, no new `Automation` field, no wire change.** An automation never starts a Mission and never passes `--mission` (a schedule would spend Mission credits with nobody present). If a Mission starts in an automation's pane anyway, it is an owned Mission.
- **Autonomy** comes from the host's default Droid arguments (Settings → Agents), as for Claude and Codex. A run that reaches an approval prompt reads as blocked and fails with "Automation agent is blocked". The editor shows a one-line note when Droid is the agent (wording left to build). No per-automation setting.
- **No extra arguments.** The interactive `droid` has `--auto` but no model or effort flag (0.248.0). Model and effort come from Droid's settings on the host, and the editor keeps hiding the field for Droid.
- **Session reuse** (desktop only; server-run automations never reuse a terminal) skips a Droid pane that Orca follows as an owned Mission, running or paused, and launches a fresh pane. After a Pause the lead reads `done`, so without this a scheduled prompt would redirect a paused Mission. The build picks the row field that marks the pane from what ADR 0005 already links (`src/renderer/src/lib/automation-session-reuse.ts`).
- **Signed-out rule.** A signed-out `droid` shows a static inline login screen about 5 s in and then nothing: no hook, no browser, no OSC 9999, no status row, process alive (watched 150 s, 0.249.0 and 0.238.0, macOS). `tui-idle` never holds, so the run is not completed after 2 minutes. It stays `dispatched` and the observer fails it at 6 h with "Orca stopped watching this run after 6h without a completion signal." A wrong `FACTORY_API_KEY` prints `Authentication failed. FACTORY_API_KEY is set but appears to be invalid...`, `droid` exits, and a bare `$` remains, with the same 6 h outcome. Add a Droid-specific rule that fails such a run as "not signed in". It must read the rendered screen (`readTerminal` with `screen: true`), because nothing else carries the state, and it must run on its own schedule, because the `tui-idle` wait it would follow never resolves. Lines identical on both versions and at 120x40 and 80x24: `Please login with your Factory account to continue.` and the menu `> Login` / `Sign into a Factory Private deployment` / `Exit`. Write the rule against a transcript captured with `config/scripts/capture-agent-pty-transcript.mjs`. Replay recordings and the probe are on `research/droid-signed-out-screen`. Wording and placement are left to the build.
- Droid terminal sessions have no floor, so an old Droid still runs a scheduled automation. A `new_per_run` automation still needs a git repository, so folder workspaces use `existing`.

## 11. Remote Control and Droid Computers (ADR 0006, #15, #25)

- A Droid Computer or Remote Control machine is an ordinary SSH host reached with `ProxyCommand droid computer ssh %h --proxy`. A user adds it with the `~/.ssh/config` snippet from Factory's docs, imported through the existing SSH config picker. Orca ships documentation, not an add-host preset.
- Orca calls none of Factory's HTTPS API, stores no Factory API key, and never registers, lists, or removes computers. It offers no Factory-targeted attach or Mission start. Persisted host ids stay `local`, `ssh:*`, `runtime:*`, so there is no migration and no wire change.
- A Mission Orca starts in a Droid terminal session on that host is owned. A Factory App Mission is observed if the reader finds its files on that host, and invisible otherwise. A session the Factory App starts has no live attach: Resume works as for any SSH session, with a confirmation unless it is known finished.
- When Factory's cloud is unreachable, the host shows the existing SSH disconnected state. Terminals the relay keeps live on for their grace period, and their verdict is `unverifiable`, never `exited`. No Factory-specific state, no direct-SSH fallback.
- Verified on a Remote Control Linux x86_64 machine (Droid 0.243.0, Orca 1.4.227): connect in about 6.8 s, relay deploy, a Droid terminal runs, and after a 35-minute relay outage the same `droid` process came back `live` in about 12 s. The machine needs a key authorized by hand. `droid computer ssh --proxy` needs Droid signed in under the Mac's `HOME`. Not seen: an `unverifiable` verdict or any disconnected indication on the Droid terminal while the relay was down (the tab froze, `orca host list` kept saying `connected`), a Factory-provisioned Droid Computer, and Mission files on a computer.

## 12. Host and client matrix

**By host**

| Capability                       | Local (macOS, Linux)                | Native Windows             | WSL                                  | SSH (incl. Droid Computers, Remote Control)  |
| -------------------------------- | ----------------------------------- | -------------------------- | ------------------------------------ | -------------------------------------------- |
| Structured Droid session         | Yes, at or above the floor          | Yes, at or above the floor | No, terminal                         | No, terminal                                 |
| Droid terminal session           | Yes                                 | Yes                        | Yes                                  | Yes                                          |
| Version and sign-in probe        | `droid --version`, protocol major 1 | Same                       | Not checked                          | Not checked                                  |
| Droid terminal process verdict   | Captured identity                   | None, `unverifiable`       | Guest `/proc` path, unchecked        | Needs a host-side check, else `unverifiable` |
| Exit watch                       | In-process                          | None                       | Guest presence path                  | Only with a host-side check                  |
| Hook install (`hooks.json`)      | Yes                                 | Yes                        | Yes (`wsl-hook-fs-adapter.ts`)       | Yes (`remote-managed-hook-installers.ts`)    |
| Mission file reader runs in      | App main or `orcad`                 | App main                   | Inside the distro, via the WSL relay | Relay or `orcad`                             |
| Signed-out login screen observed | macOS                               | Not run                    | Not run                              | Not run                                      |

**By client**

| Capability                         | Desktop             | Web client           | Mobile                                         |
| ---------------------------------- | ------------------- | -------------------- | ---------------------------------------------- |
| Structured Droid chat              | Yes                 | Yes                  | Yes (the host picks the surface)               |
| Mission Control                    | Right-sidebar panel | Same panel           | Card on the session screen plus a detail sheet |
| Start Mission                      | Yes                 | No                   | No                                             |
| Worker transcript tail             | Yes                 | No                   | No                                             |
| Hook-fed worker rows               | Yes                 | Yes                  | No (detail stream only)                        |
| Send message, Resume, Pause        | Yes                 | Yes                  | Yes (`terminal.send`)                          |
| Plan approval                      | In the terminal     | In the terminal view | In the terminal view                           |
| Mission detail stream              | Yes                 | Yes                  | Yes                                            |
| MCP section, Skills page additions | Yes                 | No                   | No                                             |
| Automation session reuse           | Yes                 | No                   | No                                             |

## 13. Compatibility and blast radius

Clients and hosts update independently. A new optional field is safe. A new stream opcode needs a negotiated capability. Changing what a host publishes reaches old clients with no wire change.

| Change                                                                          | Wire effect                                                                                                                            | Run blast-radius on                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `planMode` session option                                                       | New optional field in the options result and `setOption` key. Shown only when the host reports it.                                     | The session options types                                                                                                                                                                                                                                                                  |
| Launch setting map                                                              | New global setting. Older peers ignore it. An older host has no Droid registration and keeps opening a terminal.                       | The shared settings type (read by many callers)                                                                                                                                                                                                                                            |
| Receipt reason `agent_version_unsupported`, refusal reason `versionUnsupported` | Older peers accept any receipt reason string and show `detail`. An unknown refusal reason reads as the code's generic sentence.        | `AgentLaunchModeReason`, `structured_agent_session_unsupported` reasons (`src/shared/agent-launch-intent.ts`, `src/shared/agent-session-refusal-notice.ts`)                                                                                                                                |
| `droid-mission.detail.v1`, `droidMission.subscribeDetail`                       | New host capability and stream. Old clients never open it.                                                                             | `RUNTIME_CAPABILITIES` consumers                                                                                                                                                                                                                                                           |
| Droid child snapshots (`agentType`, `description`)                              | None. `subagents` is already on the wire.                                                                                              | None for the type. Confirm the remote hook envelope keeps `subagents` end to end for SSH (section 15)                                                                                                                                                                                      |
| Process identity capture beyond Claude                                          | `agentPresence.ended` is already on the wire. A relay without the rules never reports the early exit and its rows stay `unverifiable`. | `normalizeHookPayload` and the main, relay, and WSL-guest listeners                                                                                                                                                                                                                        |
| Ownership grammar per provider                                                  | None                                                                                                                                   | `findOwnership`, `findResumeOwnership`, the vault lookup, the resume parser                                                                                                                                                                                                                |
| MCP candidates                                                                  | None                                                                                                                                   | `src/shared/mcp-config.ts` (3 files, 1 test)                                                                                                                                                                                                                                               |
| Hook installer move                                                             | Reported config path changes only                                                                                                      | `src/main/droid/hook-service.ts`, `managed-agent-hook-registry.ts`, `remote-managed-hook-installers.ts`, `wsl-hook-fs-adapter.ts`, `src/cli/handlers/agent-hooks.ts`, the `PermissionRequest` branches. `installer-utils.ts` (about 25 agents) and `AgentHookInstallStatus` do not change. |

No new notification kind, no new provenance value, no new field on the shared agent row.

## 14. Build slices

The map's order is session core, Missions, config UIs, `droid exec` automation, Remote Control. Two slices come first because the rest depend on them. Each slice ships behind its own tests. A slice may start once the slices it needs are merged.

| #   | Slice                                                                                                                                                                                                                             | Needs                    | Done when                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Hook fix** (section 6.1). Ships early, ahead of session core.                                                                                                                                                                   | None                     | Orca's Droid hooks live in user `hooks.json` with a key-level writer on local, SSH, and WSL. The status check is per event and reads `hooksDisabled` and `allowManagedHooksOnly`. `PermissionRequest` is gone. A no-prompt `droid.initialize_session` in a throwaway `HOME` shows the hooks load (real-CLI gate, no credits). |
| 1   | **Terminal row foundation** (sections 6.3 to 6.5). Droid process identity capture, the exit watch, the lead/child listener, repeat starts, child naming.                                                                          | 0                        | Replayed hook logs from `research/droid-hook-parent-process`, `-subagent-session-start`, `-session-replacement`, `-mission-hooks` and `-mission-interrupt` produce the rows and verdicts this spec states.                                                                                                                    |
| 2   | **Session core A: registration, detection, sign-in** (sections 5.1, 5.2). Adapter on `stream-jsonrpc`, floor and protocol checks, `agent_version_unsupported`, `versionUnsupported`, sign-in copy, isolated-profile keyring flag. | 0                        | A signed-out throwaway `HOME` reaches `model_authentication_failed` on the first prompt with no credits.                                                                                                                                                                                                                      |
| 3   | **Session core B: models and effort** (5.3). Probe, registration values, `droid` project-override layer, first-prompt start.                                                                                                      | 2                        | The composer shows what 5.3 says in each of its four stages.                                                                                                                                                                                                                                                                  |
| 4   | **Session core C: modes, approvals, questions** (5.4, 5.5). `planMode`, autonomy mapping, approval cards, plan approval, block display, org cap notice, org-swapped model check.                                                  | 2                        | Fixtures from `research/droid-approval-frames` pass through the adapter.                                                                                                                                                                                                                                                      |
| 5   | **Session core D: steering** (5.6).                                                                                                                                                                                               | 2                        | The adapter test using `end-of-turn-interrupt.jsonl` settles a steer as `rejected` / `cancelled`.                                                                                                                                                                                                                             |
| 6   | **Launch setting** (section 3). Setting, shared route policy, receipt reason, settings UI.                                                                                                                                        | 2                        | Every launch path honours the setting. Needs the open placement decision.                                                                                                                                                                                                                                                     |
| 7   | **Session core E: one writer, resume, vault** (5.7, 7). Guard grammar, Droid eligibility branch, folder check, vault fixes, Resume in New CLI for chat-owned rows.                                                                | 1, 2                     | Resume is refused while a live terminal or a chat holds the session, and asks on `unverifiable`.                                                                                                                                                                                                                              |
| 8   | **Missions A: reader and detail stream** (8.2, 8.3). Version-gated reader, `droid-mission.detail.v1`, `droidMission.subscribeDetail`, the shared derivation function.                                                             | 1                        | A Mission file set from `research/droid-mission-live-observation` yields the snapshot kinds and caps in 8.3.                                                                                                                                                                                                                  |
| 9   | **Missions B: Mission Control UI** (8.4, 8.7). Desktop and web panel, mobile card and sheet, worker rows, unavailable states.                                                                                                     | 1, 8                     | Prototype states A to E and the ten mock states render from real snapshots.                                                                                                                                                                                                                                                   |
| 10  | **Missions C: controls and lifecycle** (8.5, 8.6, 8.8). Start Mission, waiting variant, Send, Pause with its gate, Resume, close/sleep/remove warnings, auto-sleep skip.                                                          | 9                        | Controls match 8.5 on a real Mission, checked by hand (section 15).                                                                                                                                                                                                                                                           |
| 11  | **Config UIs** (section 9). `.factory/mcp.json`, Droid plugin skills.                                                                                                                                                             | 0                        | Both appear on a Droid project, local and over SSH and WSL.                                                                                                                                                                                                                                                                   |
| 12  | **Automation** (section 10). Reuse skip for Mission panes, editor note, signed-out rule.                                                                                                                                          | 1, a captured transcript | A run stuck at the login screen fails as "not signed in" within the rule's schedule.                                                                                                                                                                                                                                          |
| 13  | **Remote Control** (section 11). Documentation with the `~/.ssh/config` snippet. Re-check the open gaps on a Droid Computer.                                                                                                      | 7, 10                    | Docs merged.                                                                                                                                                                                                                                                                                                                  |

## 15. Build-time checks that cannot be automated

A Mission spends credits, so these are done by hand and repeated when a version changes.

- **Mission hosting.** Whenever the Droid floor is raised, re-check that workers and validators run inside the TUI process (ADR 0005). Raising the floor without it leaves worker verdicts `unverifiable`.
- **Resume and fork flags.** Checked on 0.238.0 and 0.249.0 while building the guard grammar (`-r`, `--resume`, `droid resume`, `-s`, `--session-id`, `--fork`): the same grammar on both. Repeat it whenever the Droid floor is raised.
- **Pause gate.** Pause is gated at 0.245.1, the one version run. A by-hand Esc run on 0.238.0 and 0.244.0 can lower the gate.
- **Real-CLI gates.** A no-prompt `droid.initialize_session` in a throwaway `HOME` fires `SessionStart` with no credits. A signed-out throwaway `HOME` reaches `model_authentication_failed` on the first prompt with no credits. The signed-out terminal stops at the login screen, so no terminal-launch check can run signed out. A signed-in launch with nothing typed spends no credits.
- **Captured transcripts.** Any rule that reads a Droid screen (the signed-out rule, a future guarded Enter) is written against a transcript captured with `config/scripts/capture-agent-pty-transcript.mjs`. That script's secret scan passed a plain email in a control file, so search committed files for keys, emails, and UUIDs yourself.
- **Frames no run captured:** Droid's built-in safety list, `edit` and `create` confirmation types, `proceed_edit`, cancelling an `exec` or `apply_patch` request, several tool uses in one request, an org-managed `maxAutonomyLevel`, and an org model policy that swaps the model. Check again when a safe trigger or an org policy exists.
- **Terminal signals no run captured:** how a Droid terminal row leaves `waiting` after an approval, high-risk commands, AskUser, and Spec plan approval.
- **Unmeasured hosts.** Everything behind the host matrix marked "not run": Linux terminal identity, Windows, WSL, SSH for identity, in-place replacement hooks, the signed-out screen, Esc and Ctrl+C behaviour.
- **Fixtures live on unmerged branches** (`research/droid-*`, `prototype/droid-mission-control`). Copy the scrubbed fixtures a test needs into the repository when you write that test.

## 16. Open items and differences found

### Decisions no ticket has made

These look like real decisions. The user chose to compile the spec first.

1. **Mission credits.** The detail message carries no `credits`, and the panel's credit number is a placeholder. On disk each session's `.settings.json` holds its own credit count, so a Mission's total is the sum over its sessions, subagents included. An optional `credits` field can be added later without a new capability name. Decide before slice 9 ships the facts section. Elapsed time is decided: clients compute it from `startedAt` and `updatedAt`.
2. **Droid launch setting placement and wording** in desktop and mobile settings. Decide before slice 6.
3. **Wording** of the Droid automation editor note and of the signed-out failure message. Left to the build by #46 and #48.
4. **The row field** that marks a Droid pane as holding an owned Mission, for session reuse. Left to the build by #46.

### Differences between tickets and ADRs

Followed in this spec; the older text is stale.

- #11 says clients opt in to Mission detail through `runtime.clientCapabilities.update`. ADR 0008 and #42 reject that: a client opens the stream itself.
- #12 and ADR 0005's older wording link a Mission through `decompMissionId`. #24 found no such field on 0.242.1. The link is the `mission-session` tag.
- #12 and #11 describe the reader writing worker records and a relay capability for them. #30 and #43 replaced that with hook-fed child snapshots. The reader feeds Mission Control only.
- #19 recommends `effortDefaultsToModel: true` and `includeDisabled`. #26 reverses both.
- #30 says a lead idle `Notification` drops every child. #33 narrows it to the children of the interrupted turn, and ADR 0005 carries the narrower text.
- #12 and #11 say worker rows reach mobile with no wire change. #43 corrects it: desktop and web only.
- ADR 0004 says whether Orca clears the `settings.json` `hooks` key after migration "follows what a `/hooks` save is observed to do". #22 observed it: Droid leaves the key. This spec resolves it as "remove only Orca's entries" (6.1), but ADR 0004's sentence is still conditional. Update the ADR when slice 0 ships.
- #16 predicted that a `/hooks` save might clear the key. #22 observed that it does not.
- #48 corrects #46's premise: a signed-out run is not falsely completed after 2 minutes. It hangs for 6 hours with a message that does not name the cause.

### Unmeasured shapes carried by the map

None of these blocks a slice. Each is named in the map's "Not yet specified" section with its source ticket.

- Forced auto-update screen at Droid terminal startup (a scheduled run can hit it unattended; whether `agent-update-prompt` covers it is unchecked). Whether a long-running structured session on Windows holds `droid.exe` and blocks Droid's update.
- Exit-watch timings (0.25 s to 8 s backoff, 90 s bound) and the 10 s background-child lease are defaults from one observation. `SessionEnd` reasons for `/exit`, SIGTERM, SIGHUP.
- Which SSH-host process runs the Droid hook listener and whether it has the in-process presence check. Whether the remote hook envelope keeps `subagents` end to end for SSH. What Orca shows for a Droid terminal while an SSH relay is unreachable.
- A paused validator's reviewer subagents may still hold the row `working`. A pause at a retry or iteration limit never produced hooks or files. Esc with a message queued. Whether a relaunched `droid --resume` continues a paused Mission. What `/new`, `/resume`, `/tree` do to a Mission running in a pane. A Mission started in a session that already had turns.
- How the Mission reader finds and refreshes a Mission's files (watch or poll, on SSH and WSL).
- Start Mission and the worker transcript tail on mobile and web. Older log entries and full handoff text on mobile and web.
- Child work missing from `worktree ps` and the mobile worktree list, for every agent.
- Whether any Droid hook payload carries a usable name for a plain `Task` subagent.
- Enter on "Begin new mission" in an onboarded profile and the Enter after the credit panel were never pressed. Nothing depends on them today.
- Droid Computer (Factory-provisioned) behaviour and Factory-App Mission files on a computer.
- Whether a pending steer needs a visible marker. Several steers pending at once, and a discard of an `end_of_loop` message.
- Smaller session findings: the stray `<uuid>.settings.json` under `~/.factory/sessions/`, what writes `~/.factory/projects`, folder slugs for Windows and WSL, a deleted recorded folder (loads with the loader's folder; the terminal `droid --resume` can still hit it), `SessionStart` hook `cwd` differing between structured and terminal loads, why some terminal starts run no `SessionStart`.

## 17. Decision index

Every closed ticket is accounted for. "Fact" means the ticket established what Droid does and the spec relies on it.

| Ticket                                                                            | Kind                                            | Where         |
| --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------- |
| [#2](https://github.com/codeious/orca/issues/2) protocol surface                  | Fact                                            | 5.1, ADR 0001 |
| [#3](https://github.com/codeious/orca/issues/3) driving a Mission                 | Fact                                            | 8.2, 8.5      |
| [#4](https://github.com/codeious/orca/issues/4) where workers run                 | Fact (corrected by #17 for the interactive CLI) | 8.1           |
| [#5](https://github.com/codeious/orca/issues/5) config surfaces                   | Fact                                            | 9             |
| [#6](https://github.com/codeious/orca/issues/6) Remote Control                    | Fact                                            | 11            |
| [#7](https://github.com/codeious/orca/issues/7) install, sign-in, headless        | Fact (superseded in part by #18)                | 5.2           |
| [#8](https://github.com/codeious/orca/issues/8) protocol choice                   | Decision, ADR 0001                              | 5.1           |
| [#9](https://github.com/codeious/orca/issues/9) modes and autonomy                | Decision, ADR 0002                              | 5.4, 5.5      |
| [#10](https://github.com/codeious/orca/issues/10) coexistence                     | Decision, ADR 0003                              | 3, 5.1, 5.7   |
| [#11](https://github.com/codeious/orca/issues/11) Mission end to end              | Decision, ADR 0008                              | 8.2, 8.5, 8.6 |
| [#12](https://github.com/codeious/orca/issues/12) ownership and worktrees         | Decision, ADR 0005                              | 8.1, 8.8      |
| [#13](https://github.com/codeious/orca/issues/13) Mission Control look            | Decision, prototype                             | 8.4           |
| [#14](https://github.com/codeious/orca/issues/14) config UIs                      | Decision, ADR 0004                              | 6.1, 9        |
| [#15](https://github.com/codeious/orca/issues/15) Remote Control use              | Decision, ADR 0006                              | 11            |
| [#16](https://github.com/codeious/orca/issues/16) hooks.json vs settings.json     | Fact                                            | 6.1           |
| [#17](https://github.com/codeious/orca/issues/17) live Mission behaviour          | Fact                                            | 8.1           |
| [#18](https://github.com/codeious/orca/issues/18) detection and sign-in           | Decision (no ADR)                               | 5.2           |
| [#19](https://github.com/codeious/orca/issues/19) model listing                   | Decision (no ADR)                               | 5.3           |
| [#20](https://github.com/codeious/orca/issues/20) `end_of_turn` placement         | Decision (no ADR)                               | 5.6           |
| [#21](https://github.com/codeious/orca/issues/21) approval and settings frames    | Fact                                            | 5.4, 5.5      |
| [#22](https://github.com/codeious/orca/issues/22) `/hooks` saves, approvals       | Fact                                            | 6.1, 6.2      |
| [#23](https://github.com/codeious/orca/issues/23) session sharing                 | Fact                                            | 7             |
| [#24](https://github.com/codeious/orca/issues/24) Mission hooks and metadata      | Fact                                            | 6.5, 8.1      |
| [#25](https://github.com/codeious/orca/issues/25) SSH via `--proxy`               | Fact                                            | 11            |
| [#26](https://github.com/codeious/orca/issues/26) model and effort display        | Decision (no ADR)                               | 5.3           |
| [#27](https://github.com/codeious/orca/issues/27) discarded steer                 | Decision (no ADR)                               | 5.6           |
| [#28](https://github.com/codeious/orca/issues/28) loaded-session folder           | Fact                                            | 7             |
| [#29](https://github.com/codeious/orca/issues/29) one writer                      | Decision, ADR 0007                              | 7             |
| [#30](https://github.com/codeious/orca/issues/30) lead vs child                   | Decision, ADR 0005                              | 6.5           |
| [#31](https://github.com/codeious/orca/issues/31) hook parent process             | Fact                                            | 6.3           |
| [#32](https://github.com/codeious/orca/issues/32) Task subagent and `/new` starts | Fact                                            | 6.5           |
| [#33](https://github.com/codeious/orca/issues/33) late and missing hooks          | Decision, ADR 0005, 0007                        | 6.4, 6.5      |
| [#34](https://github.com/codeious/orca/issues/34) in-place replacement            | Fact                                            | 6.4, 6.5      |
| [#35](https://github.com/codeious/orca/issues/35) arrival order                   | Fact                                            | 6.4           |
| [#36](https://github.com/codeious/orca/issues/36) slow start hook                 | Fact                                            | 6.4           |
| [#37](https://github.com/codeious/orca/issues/37) repeat start                    | Decision, ADR 0005                              | 6.5           |
| [#38](https://github.com/codeious/orca/issues/38) two hook commands               | Fact                                            | 6.4           |
| [#39](https://github.com/codeious/orca/issues/39) process-confirmed exit          | Decision, ADR 0007                              | 6.4           |
| [#40](https://github.com/codeious/orca/issues/40) interrupt behaviour             | Fact                                            | 8.5           |
| [#41](https://github.com/codeious/orca/issues/41) `/missions` launch              | Fact                                            | 8.5           |
| [#42](https://github.com/codeious/orca/issues/42) detail message                  | Decision, ADR 0008                              | 8.3           |
| [#43](https://github.com/codeious/orca/issues/43) worker row wording              | Decision, ADR 0005, 0008                        | 6.5, 8.7      |
| [#44](https://github.com/codeious/orca/issues/44) Pause                           | Decision, ADR 0005, 0007, 0008                  | 8.5           |
| [#45](https://github.com/codeious/orca/issues/45) Start Mission keys              | Decision, ADR 0008                              | 8.5           |
| [#46](https://github.com/codeious/orca/issues/46) `droid exec` automation         | Decision, ADR 0008                              | 10            |
| [#47](https://github.com/codeious/orca/issues/47) fork over `stream-jsonrpc`      | Fact                                            | 7             |
| [#48](https://github.com/codeious/orca/issues/48) signed-out screen               | Fact                                            | 10            |
| [#49](https://github.com/codeious/orca/issues/49) Fork into new chat              | Decision, ADR 0007                              | 7             |

Research notes, fixtures, and probes for the facts above are on the unmerged `research/droid-*` branches (for example `research/droid-session-protocol`, `-approval-frames`, `-steering-placement`, `-mission-hooks`, `-mission-interrupt`, `-signed-out-screen`) and the `prototype/droid-mission-control` branch.
