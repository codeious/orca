# Does a message sent with end_of_turn reach Droid before its agent loop ends?

## Question

[Which protocol should Orca use for structured Droid sessions?](https://github.com/codeious/orca/issues/8) chose `steering: 'inject'`: a message sent while a turn runs goes straight to Droid as `droid.add_user_message` with `queuePlacement: end_of_turn`, which Droid's own client groups as "steering" (`end_of_loop` is "queued"). That came from SDK source only. This note checks it on a live `stream-jsonrpc` session: when each placement's message lands, which notifications mark it, and whether the spec keeps `inject` or ships `queue`.

## Short answer

`inject` stands. A mid-turn `end_of_turn` message reaches the model at the next tool-result boundary, inside the same turn, and it does not cancel the tool that is running. `end_of_loop` waits until the loop's final reply. Two things the adapter must handle:

- Droid never says "queued". The only notification that names the message is a later `create_message` that echoes the request id. Orca has to track the pending message itself until that frame arrives.
- A pending `end_of_turn` message is thrown away when the turn is interrupted. Droid marks that with `queued_messages_discarded`, which carries the text and the request id.

## Findings

### Setup

- Droid CLI 0.239.0 (newer than the 0.238.0 floor; 0.238.0 itself was not installed). Responses carried `factoryProtocolVersion` `1.260.0`.
- `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc`, spawned by `probe.mjs` with the user's own Droid login. `ORCA_*`, `FACTORY_SESSION_ID`, and `FACTORY_UPSTREAM_CLIENT_TYPE` were removed from the child environment, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, and the working directory was an empty folder under `/tmp`.
- Session settings came from `droid.initialize_session` (`--auto` has no effect in this mode): `autonomyLevel: "high"`, `interactionMode: "auto"`, so no permission prompt fired. The script still answers `droid.request_permission` and `droid.ask_user` in case one does. None arrived.
- Model: `gpt-5.4-mini`, reasoning effort `low` for the four fixture runs. A first run on `gpt-6-luna` (effort `none`) is described below. No Mission was started.
- Prompt: run five `sleep 4 && echo STEPn` commands one tool call at a time. The steer text carries a marker (`STEERMARK-7Q`) and asks the model to skip the remaining commands and reply `STEERED-7Q`.
- Cost: about 35k `factoryCredits` units across the four fixture runs, as Droid reports them in `agent_turn_completed.tokenUsage`.

### Results

Times are milliseconds since the process started, from the fixtures. "Landed" is the first `create_message` with `role: "user"` and `requestId` equal to the steer's JSON-RPC id.

| Run | Placement | Sent | Landed | Lag | Landed right after | Commands that ran | Turn end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A, mid-loop | `end_of_turn` | 21,526 (command 2 running) | 25,557 | 4,031 | `tool_result` of command 2 (25,553) | 2 of 5 | one `agent_turn_completed` at 31,321, reason `completed`; final reply `STEERED-7Q` |
| B, mid-loop | `end_of_loop` | 21,881 (command 2 running) | 59,392 | 37,511 | the loop's final reply `FINISHED` (59,358) | 5 of 5 | one `agent_turn_completed` at 64,450, after the reply to the queued message (64,426) |
| C, late | `end_of_turn` | 24,568 (final answer streaming) | 27,378 | 2,810 | that assistant message (27,374) | 1 of 1 | one `agent_turn_completed` at 35,266; the model answered the steer in the same turn |
| D, then interrupt | `end_of_turn` | 12,384 (first command running) | never | n/a | n/a | cancelled | `agent_turn_completed` reason `cancelled` at 13,941 |

What each run shows:

- **A.** The running command was not cut short: its result arrived after the send, and the steer landed 4 ms later. The model then made no more tool calls. Commands 3 to 5 never started. That is "between tool calls", not "after the loop".
- **B.** Everything ran. The queued message was consumed 34 ms after the final reply, and Droid never reported `idle` in between (`thinking` follows the reply directly). One `agent_turn_completed` closes both replies, so a turn boundary does not separate them.
- **C.** With no tool boundary left, `end_of_turn` was not lost. It landed right after the current assistant message and the loop ran once more in the same turn.
- **D.** `droid.interrupt_session` 1.5 s after the send: `tool_result` ("Error: Tool execution cancelled by user") at +1 ms, `queued_messages_discarded` at +3 ms, the interrupt response at +5 ms, a second identical `tool_result` at +34 ms, `agent_turn_completed` `cancelled` at +53 ms. No echo, no new turn.

First run (not a fixture, `gpt-6-luna`): the steer landed at the same point (4,213 ms after the send, 4 ms after command 2's `tool_result`, `parentId` pointing at that result), but the model ignored it and ran all five commands. Delivery is Droid's job and obeying is the model's, so a fixture or test must not depend on the model following the text.

### What marks the message

- `droid.add_user_message` answers `result: {}` within 0 to 11 ms in every run, whatever the placement and whatever the turn is doing. It is an acknowledgement of receipt only.
- No notification between the send and the landing refers to the message. The types seen in that window were the ordinary loop ones (`tool_call`, `tool_execution_phase_changed`, `tool_progress_update`, `tool_result`, `droid_working_state_changed`, `session_token_usage_changed`, `assistant_text_*`, `create_message` for assistant rows, and hook events).
- The landing is `droid.session_notification` with `notification.type: "create_message"`: `message.role: "user"`, the text, `requestId` (the steer's JSON-RPC id), `parentId` (the preceding message: the `tool_result` message in A, the assistant message in B and C), and a `seq` assigned at landing.
- Empty `create_message` rows with `visibility: "llm_only"` (ids starting `__internal__system-reminder__` or `todo-suggest-`) follow landings and turn changes. A renderer must skip them.
- `queued_messages_discarded` is `{ type, text, requestId }`. The `requestId` matches the steer.

### Other things the frames showed

- `tool_call` repeats for one tool: first with `input: {}`, then with the full input (two or three times per tool). It has no `sessionId`. Key on `toolUse.id`.
- An interrupted tool produced two `tool_result` notifications for the same `toolUseId`.
- `agent_turn_completed` is the only turn boundary. It carries `reason` (`completed`, `cancelled`) and per-turn `tokenUsage` including `factoryCredits`.

### Not tested

- A send while a permission or AskUser prompt is open (`waiting_for_tool_confirmation`). That belongs to [What do Droid's approval, block, and settings frames look like in a live session?](https://github.com/codeious/orca/issues/21).
- A mid-turn send inside a Mission. Research must not start one.
- Sends on an idle session (`end_of_turn` on an idle session starts a turn in the SDK's controller; not observed here).
- Droid 0.238.0 exactly.
- Several steers queued in a row, or `droid.resolve_queued_user_message` (it needs a daemon-style queue the exec process did not offer here).

## Fixtures

`research/droid-steering-placement/`:

- `end-of-turn.jsonl` (A), `end-of-loop.jsonl` (B), `end-of-turn-late.jsonl` (C), `end-of-turn-interrupt.jsonl` (D). One line per frame: `{ t, dir, frame }` with `dir` of `out`, `in`, or `mark` (the probe's own annotations).
- Scrubbed by `scrub.mjs`: only the frame kinds listed in it are kept; the `droid.initialize_session` result is reduced to the session id; `_meta` is removed; reasoning `signature` values are elided; session, message, and tool ids are renumbered; the temp working directory becomes `<tmp-cwd>`. Hook, MCP, settings, title, token-usage, delta, and progress frames are dropped because they carry user configuration or bulk.
- `probe.mjs` runs a scenario (`run`, `late`, `interrupt`, `models`). `timeline.mjs` prints a raw log as a readable timeline. The raw logs were not kept.

## Evidence log

- `droid --version` → 0.239.0. `droid exec --help` (stream-jsonrpc ignores `--auto`).
- `@factory/droid-sdk@0.9.1` declarations and `dist/chunk-*.mjs`: `QueuePlacement`, `QUEUED_MESSAGES_DISCARDED`, `QueuedMessagesDiscardedNotificationSchema`, `AddUserMessageRequestParamsSchema`, `QueuedUserMessageDisplayGroup` (`daemon_queued_discardable` → steering, `daemon_queued_end_of_loop` → queued). Those labels are the daemon controller's; the live exec behaviour above is what this note rests on.
- Four live runs on `gpt-5.4-mini` and one on `gpt-6-luna`, as above.
- Orca: `src/shared/agent-session-capabilities.ts` (`steering: 'inject' | 'queue'`); Claude, Codex, and Pi declare `inject`, the shared ACP definition declares `queue`.

## Unknowns and risks

- Behaviour on exactly 0.238.0 and on future builds. The frames here are 0.239.0 with protocol `1.260.0`.
- Whether Droid's landing point shifts when a tool batch runs several tools in parallel. The prompt forced one tool call at a time.
- Whether the discard on interrupt also applies to `end_of_loop` messages. Only `end_of_turn` was interrupted.

## Confidence

| Finding | Confidence |
| --- | --- |
| `end_of_turn` lands at the next tool-result boundary and does not cancel the running tool | high (two models, same landing point) |
| `end_of_loop` lands after the final reply, within the same turn | high (one run) |
| `end_of_turn` with no boundary left lands after the current assistant message | medium (one run) |
| No queued notification exists for the message | high for the types seen; Droid could add one later |
| Interrupt discards a pending `end_of_turn` message and marks it | high (one run) |
| The model obeys the steer | not a Droid property; varies by model |
