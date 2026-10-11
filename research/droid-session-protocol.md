# Which Droid protocol exposes the full session surface?

## Question

Which Droid protocol exposes the full session surface Orca's structured-agent adapter needs: start, resume, and fork; image turns; streamed text, reasoning, tools, subagents, and token usage; permission and AskUser answers; interrupt; live changes to model, reasoning effort, autonomy, and spec mode; compact; and listing slash commands, skills, and custom droids?

Compared across `--output-format acp`, `stream-jsonrpc` (`droid.*`), the TypeScript and Python SDKs, deprecated `stream-json`, and `droid daemon`.

## Short answer

`stream-jsonrpc` is that protocol. `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc` speaks `droid.*` over newline-delimited JSON-RPC and is the surface Factory documents as the full control API.

The TypeScript and Python SDKs are clients of it. `droid daemon` speaks a second, wider `daemon.*` vocabulary over a local socket, including the same session operations. ACP (`droid exec --output-format acp`) is a different, capability-negotiated protocol and does not advertise rewind, fork, or compact. `stream-json` is a deprecated event log, not the control surface.

None of them has a custom-droid catalog method. Custom droids show up only as name, location, and token counts on the context-breakdown result.

## Findings

### What was compared

Orca's structured agent declares capabilities before a session runs (`rewind`, `compact`, `threadGoal`, `contextUsage`, `imagePrompts`, `steering` of `inject` or `queue`, `approvalEnforcement` of `provider` or `orca`) in `src/shared/agent-session-capabilities.ts`. A definition is `StructuredAgentDefinition` in `src/main/native-chat/agent-session-wire/structured-agent-definition.ts`. The adapter's required methods are `acquire`, `dispatch`, `cancelTurn`, `answerPrompt`, and `setOption`; `rewind`, `compact`, `readCommands`, and `changeThreadGoal` are optional (`src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts`).

Installed CLI: `droid` 0.238.0 (`droid --version`). `droid exec --help` lists `--output-format` values `text`, `json`, `stream-json`, `stream-jsonrpc`, and `acp`. The exec overview's flag table omits `acp` even though the same page names ACP mode when saying `--disable-builtin-skills` is not supported there (https://docs.factory.com/droid-exec/overview).

### Matrix

Cells: **yes** = a published method or SDK call; **observed** = seen on CLI 0.238.0 with no model prompt; **no** = absent from the published surface and from what was observed; **unknown** = not documented and not observed.

| Capability | ACP | stream-jsonrpc | TypeScript SDK | Python SDK | stream-json | daemon |
| --- | --- | --- | --- | --- | --- | --- |
| Start | observed `session/new` | yes `droid.initialize_session` | yes `createSession()` | yes `Session` | no live method; one-shot `droid exec` only | yes `daemon.initialize_session` |
| Resume | observed `loadSession` and `sessionCapabilities.resume` | yes `droid.load_session` | yes `resumeSession()` | yes `Session.resume()` | no; `--session-id` is a one-shot flag | yes `daemon.load_session` |
| Fork | no | yes `droid.fork_session` | yes `DroidSession.fork()` | yes `session.fork()` | no; `--fork` is a one-shot flag | yes `daemon.fork_session` |
| Image turn | observed `promptCapabilities.image` | yes, images on `droid.add_user_message` | yes, `MessageOptions.images` | yes, `stream(images=...)` | not a control method | yes, `daemon.add_user_message` |
| Streamed text | ACP `session/update`; kinds not published by Factory | yes `assistant_text_delta` | yes, stream deltas | yes `TextDelta` | deprecated output log | yes `daemon.session_notification` |
| Reasoning | unknown | yes `thinking_text_delta` | yes, partial stream | yes `ThinkingDelta` | changelog says exec output gained reasoning events in CLI 0.95.0 | same notification family |
| Tool events | changelog "ACP tool call lifecycle" in CLI 0.121.0; schema not published | yes `tool_call`, `tool_result`, `tool_progress_update` | yes | yes `ToolCall`, `ToolResult`, `ToolProgress` | not a control method | same notification family |
| Subagent events | unknown | yes `child_session_available`; tool progress carries `subagentSessionId` | yes via notifications | yes `ToolProgressUpdate.subagent_session_id` | not published | yes `daemon.kill_worker_session` |
| Token usage | unknown | yes `session_token_usage_changed` | yes | yes `TokenUsageUpdate` and `result.usage` | not published | not a separate documented high-level call |
| Answer permission | not in Factory docs | yes `droid.request_permission` | yes `permissionHandler` | yes `on_permission` | no peer | yes `daemon.request_permission` |
| Answer AskUser | unknown | yes `droid.ask_user` | yes `askUserHandler` | yes `on_question` | no | yes `daemon.ask_user` |
| Interrupt | yes, ACP cancel by CLI 0.115.0 | yes `droid.interrupt_session` | yes `interrupt()` | yes `session.interrupt()` | no | yes `daemon.interrupt_session` |
| Set model | observed config option `model` | yes `droid.update_session_settings` | yes `updateSettings` | yes `update_settings(model=)` | no live change | yes `daemon.update_session_settings` |
| Set reasoning effort | observed config option `reasoning_effort` | yes, same method | yes | yes | no | yes |
| Set autonomy | observed config option `autonomy_level` | yes `autonomyLevel` | yes | yes `Autonomy` | no; `--auto` is launch-only | yes |
| Spec mode | observed mode id `spec` | yes `interactionMode` `spec` | yes `enterSpecMode` / `exitSpecMode` | yes `enter_spec` / `leave_spec` | no; `--use-spec` is launch-only | yes |
| Compact | unknown | yes `droid.compact_session` | yes `compact()` | yes `session.compact()` | no | yes `daemon.compact_session` |
| List slash commands | observed `availableCommands` on `session/update` | yes `droid.list_commands` | yes `DroidClient.listCommands()`; not on `DroidSession` | no published method | no | yes `daemon.list_commands` |
| List skills | unknown as a list separate from commands | yes `droid.list_skills`, `droid.set_skill_disabled` | yes `listSkills()` / `setSkillDisabled()` | yes `list_skills()`, `enable_skill()`, `disable_skill()` | no | yes `daemon.list_skills` |
| List custom droids | no | no catalog method | no | no | no | no |

### stream-jsonrpc

Factory's exec overview calls this the full JSON-RPC control surface. Each stdin line is one request; each stdout line is a response, a server request, or a notification. The published prose names `droid.initialize_session`, `droid.load_session`, `droid.add_user_message`, `droid.session_notification`, `droid.request_permission`, and `droid.ask_user`, and says further methods interrupt work, update settings, manage MCP, inspect context, fork, or compact (https://docs.factory.com/droid-exec/overview#build-custom-flows-on-raw-json-rpc).

The method and notification enums are in the published package `@factory/droid-sdk@0.9.1` (`dist/index-C06W9tbN.d.ts`). `DroidServerMethod` includes initialize, load, add user message, append messages, resolve queued user message, interrupt, close, kill worker, update settings, list models, list tools, list skills, set skill disabled, list commands, get context stats, get context breakdown, compact, fork, rewind info, execute rewind, and rename. `DroidClientMethod` is `droid.session_notification`, `droid.request_permission`, and `droid.ask_user`. `SessionNotificationType` includes assistant text and thinking deltas, tool call, tool result, tool progress, token usage, settings updated, working state, session compacted, child session available, mission events, hook execution, and `agent_turn_completed`.

`QueuePlacement` is `end_of_turn` or `end_of_loop`. That is Orca's `queue` steering, not `inject`. There is no thread-goal method.

`GetContextBreakdown` includes `droids: { name, location, tokens }[]` with `DroidLocation` `project` or `personal`. That is token accounting, not a catalog of custom droids. `droid.list_commands` returns command name, description, optional argument hint, and whether it is executable. It is not documented as the custom-droid list.

`AutonomyLevel` is `off | low | medium | high`. `DroidInteractionMode` is `auto | spec | mission` (`agi` is deprecated). `ReasoningEffort` includes `off`, `low`, `medium`, `high`, `xhigh`, and `max`.

The SDK declares `FACTORY_PROTOCOL_VERSION` `"1.201.1"` and `LEGACY_FACTORY_API_VERSION` `"1.0.0"`. Requests the SDK sends also carry `type: "request"`.

Observed on 0.238.0, with no user prompt: a request that matched the docs' bare example (`jsonrpc`, `id`, `method`, `params` only) was rejected with code `-32700` and message `Invalid JSON-RPC message`. The same `droid.initialize_session` succeeded when it also carried `type: "request"`, `factoryApiVersion: "1.0.0"`, and `factoryProtocolVersion: "1.201.1"`. The CLI answered with `factoryProtocolVersion` `"1.257.0"` and `factoryApiVersion` `"1.0.0"`. The result included an empty message list, settings (`modelId`, `reasoningEffort`, `autonomyMode`, `interactionMode`, `autonomyLevel`, `specModeModelId`, `specModeReasoningEffort`), and `availableModels` (one entry has id `auto` and kind `router`). `droid.close_session` then returned an empty result. Which of the three extra fields the parser requires was not isolated. Notifications seen before the result were `mcp_status_changed`, `settings_updated`, and hook execution start/complete. No account identifiers are recorded here.

`AgentTurnCompletionReason.NoApproverAvailable` is documented on the type as the outcome when a one-shot `stream-jsonrpc` process has no JSON-RPC peer on stdin, so a permission or AskUser request cannot be answered.

### TypeScript and Python SDKs

`@factory/droid-sdk@0.9.1` (Node `>=18`): `@factory/droid-sdk/node` spawns `droid`; the package root connects to an existing daemon (`package/README.md` in that tarball). `DroidClient` exposes `initializeSession`, `addUserMessage`, `listCommands`, `listSkills`, and `getContextBreakdown`. The higher-level `DroidSession` exposes `stream`, `interrupt`, `updateSettings`, `enterSpecMode`, `exitSpecMode`, `listSkills`, `setSkillDisabled`, `getContextStats`, `compact`, `fork`, and `rewind`. It does not declare `listCommands` or `getContextBreakdown`. `DroidProcessMode` includes `acp` and `stream-jsonrpc`.

Python `droid-sdk` 0.5.0 (https://docs.factory.com/docs/sdk/python, https://pypi.org/pypi/droid-sdk/json) runs a local `droid` subprocess only. Published session operations cover resume, images and files, permission and AskUser handlers, interrupt, `update_settings` (model, reasoning effort, mode, autonomy, spec model), `enter_spec` / `leave_spec`, compact, fork, rewind, `list_skills`, `context()`, and partial events for text, thinking, tools, token usage, and `subagent_session_id`. It publishes no `list_commands`, no custom-droid list, and no daemon client. One session runs one turn at a time.

npm release dates for `@factory/droid-sdk`: 0.1.0 on 2026-03-25, 0.9.1 on 2026-09-04. PyPI: 0.1.1 on 2026-03-25, 0.5.0 on 2026-09-24. Neither page states a minimum CLI version.

### ACP

IDE docs launch Droid as an Agent Client Protocol agent with `droid exec --output-format acp` (https://docs.factory.com/ide-integrations). The changelog never uses the words "Agent Client Protocol". The first headline that says ACP is CLI 0.48.0 (2026-01-13), "ACP streaming". CLI 0.56.0 (2026-01-27) says "Agent Control Protocol" for "ACP daemon mode". CLI 0.115.0 (2026-05-01) fixes ACP cancel. CLI 0.125.0 (2026-05-13) adds ACP `session/set_config_option`. Factory publishes no ACP method catalog.

Observed `initialize` on 0.238.0: `protocolVersion` 1, `loadSession: true`, `sessionCapabilities` `list` and `resume`, `promptCapabilities` `image` and `embeddedContext`, `_meta` `terminal-auth: true`, auth method ids `device-pairing` and `factory-api-key`, `agentInfo.title` `Factory Droid`, `agentInfo.version` `0.238.0`. No MCP capability and no config-option capability were on that initialize result.

A following `session/new` (no prompt) returned `modes` `normal`, `spec`, `auto-low`, `auto-medium`, and `auto-high`, and `configOptions` with ids `autonomy_level`, `model`, and `reasoning_effort`. The reasoning option names were Off, Low, Medium, High, and Extra High. One autonomy option is named Spec. Before the result, the process sent `session/update` with `availableCommands`. Rewind, fork, and compact were not in the initialize capabilities or the session/new result. Permission and AskUser methods were not exercised and are not in the Factory ACP docs.

Orca's generic ACP definition (`src/main/acp/acp-structured-agent-definitions.ts`) sets `rewind: false`, `threadGoal: false`, `steering: 'queue'`, `approvalEnforcement: 'orca'`, `compact` only when the launch spec says so, and option keys `model` and `effort` only. Droid's observed ACP session adds autonomy and a spec mode, which that definition does not accept.

### stream-json

The exec overview says the old `stream-json` input still parses, warns, and should be replaced by `stream-jsonrpc`. Observed on 0.238.0: `droid exec --input-format stream-json --output-format stream-json` with stdin closed immediately exited 0, wrote no stdout, and warned that `stream-json` is deprecated in favor of `stream-jsonrpc`. The changelog's oldest entry, CLI 0.19.8 (2025-09-30), is titled as streaming JSON input mode. CLI 0.21.3 (2025-10-14) adds `session_id` to the system init event. CLI 0.36.0 adds `reasoning_effort` on that event. CLI 0.95.0 adds reasoning events to exec output. It is not the permission or settings API.

### daemon

`droid daemon --help` on 0.238.0 describes a local server: websocket on `127.0.0.1:4132` by default, or `ipc` on a unix socket. The changelog feed has no line naming the `droid daemon` subcommand. The first note that says "daemon" is CLI 0.56.0, "ACP daemon mode", which is not the same claim.

`DaemonDroidMethod` in `@factory/droid-sdk@0.9.1` mirrors the session methods (`daemon.initialize_session`, `daemon.load_session`, `daemon.add_user_message`, `daemon.interrupt_session`, `daemon.update_session_settings`, `daemon.list_skills`, `daemon.list_commands`, `daemon.compact_session`, `daemon.fork_session`, `daemon.get_rewind_info`, `daemon.execute_rewind`, `daemon.get_context_breakdown`) and adds daemon-only management (opened sessions, archive, files, plugins, automations, crons, git, worktrees). It has no `append_messages`, no `get_context_stats`, and no `list_tools`. `DaemonDroidEvent` is `daemon.session_notification`, `daemon.request_permission`, and `daemon.ask_user`. `DaemonSessionController` documents itself as the WebSocket client and exposes `listCommands(sessionId)` and `listSkills(sessionId)`.

### Minimum versions that are actually published

| Protocol | Earliest published marker | What it does not prove |
| --- | --- | --- |
| `stream-json` input | CLI 0.19.8 (2025-09-30), oldest changelog entry | That 0.19.8 was the first build with it |
| `stream-jsonrpc` | CLI 0.22.9 (2025-11-01), permission flow | The first build that accepted `droid.*` |
| ACP | CLI 0.48.0 (2026-01-13), headline "ACP streaming"; config options by 0.125.0 (2026-05-13); cancel by 0.115.0 (2026-05-01) | The first build of `--output-format acp` |
| TypeScript SDK | package 0.1.0 (2026-03-25); current 0.9.1 (2026-09-04) | A minimum `droid` version |
| Python SDK | package 0.1.1 (2026-03-25); current 0.5.0 (2026-09-24) | A minimum `droid` version |
| `droid daemon` | the subcommand exists in CLI 0.238.0 | When the subcommand first shipped |

Changelog source: https://docs.factory.com/docs/changelog/feed.json (237 CLI items, 0.19.8 through 0.237.0). Installed 0.238.0 is newer than that feed.

### Gaps against the Orca adapter

`stream-jsonrpc`, and the SDKs sitting on it, can back `acquire`, `dispatch` (including images), `cancelTurn`, `answerPrompt` for both approval and question, `setOption` for model, effort, autonomy, and spec, plus optional `compact`, `rewind`, and `readCommands`. They cannot back `changeThreadGoal`. Steering is queue, not inject. Permission answers are client-side (`approvalEnforcement: 'orca'`); autonomy levels also confine work before a prompt (`provider`).

ACP, as Droid 0.238.0 advertised it, can start, resume, take images, list commands, and change model, reasoning effort, autonomy, and spec. It did not advertise rewind, fork, or compact. Factory does not document ACP permission, AskUser, reasoning deltas, subagent events, or token usage.

`stream-json` cannot host the permission peer. `daemon.*` can back the same session operations as `droid.*`, but it is a different method prefix on a different server, and the Python SDK does not speak it.

## Evidence log

- https://docs.factory.com/droid-exec/overview — output formats, JSON-RPC method names, deprecation of `stream-json`, ACP note on `--disable-builtin-skills`. The bare initialize example on that page was rejected by CLI 0.238.0.
- https://docs.factory.com/docs/sdk/python — Python session, stream, settings, spec, compact, fork, rewind, skills, context, permissions, AskUser. No command list and no daemon client.
- https://docs.factory.com/ide-integrations — ACP launch `droid exec --output-format acp`.
- https://docs.factory.com/docs/changelog/feed.json — version markers in the table above.
- https://pypi.org/pypi/droid-sdk/json — Python 0.5.0 (2026-09-24), requires Python `>=3.10`.
- npm pack of `@factory/droid-sdk@0.9.1` (not installed into this repo). Declarations in `dist/index-C06W9tbN.d.ts` and `dist/node.d.ts`: `DroidServerMethod`, `DroidClientMethod`, `SessionNotificationType`, `DaemonDroidMethod`, `DaemonDroidEvent`, `DroidSession`, `DroidClient`, `FACTORY_PROTOCOL_VERSION`.
- `droid --version` → 0.238.0. `droid exec --help` includes `acp`. `droid daemon --help` describes websocket `127.0.0.1:4132` and ipc.
- Live frames, no model prompt, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`: bare `droid.initialize_session` → `-32700` `Invalid JSON-RPC message`; SDK envelope → success then `droid.close_session`; ACP `initialize` and `session/new` as in Findings; empty `stream-json` → deprecation warning, exit 0, no stdout.
- Orca: `src/shared/agent-session-capabilities.ts`; `src/main/native-chat/agent-session-wire/structured-agent-definition.ts`; `src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts` lines 283, 292, 322, 334, 340, 369, 377, 390; `src/main/acp/acp-structured-agent-definitions.ts` lines 13 and 35–44.

## Unknowns and risks

- The changelog does not record the first CLI build of `--output-format acp` or of the `droid daemon` subcommand. 0.48.0 and 0.56.0 are the first notes that use those words, not proof of introduction.
- ACP compact, rewind, fork, permission, AskUser, reasoning deltas, subagent events, token usage, and a skill list separate from `availableCommands` were not in the Factory docs or in the initialize / session-new frames. They were not probed with a prompt.
- The docs' bare JSON-RPC example fails on 0.238.0. It is untested which single envelope field (`type`, `factoryApiVersion`, `factoryProtocolVersion`) the parser requires.
- CLI 0.238.0 reports protocol `1.257.0`. SDK 0.9.1 declares `1.201.1`. Initialize with `1.201.1` succeeded. Newer methods than the SDK declares would not show up in 0.9.1's enums.
- `droid.list_commands` was not called. Its result schema does not document custom droids. Context-breakdown `droids` is the only published listing, and it is token accounting.
- ACP `session/new` created a local session and no prompt was sent. The session id is not recorded here.

## Confidence

High that `stream-jsonrpc` is the full session surface, that both SDKs are clients of it, that `daemon.*` is a second vocabulary with the same session operations plus daemon management, and that ACP and `stream-json` are not that surface. High for the method names, because they are in the published 0.9.1 declarations and the initialize path was observed. Medium for ACP cells marked unknown, and for the exact first CLI build of ACP and `droid daemon`.
