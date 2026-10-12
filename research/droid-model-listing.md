# How does Orca list Droid's models before a session runs?

## Question

Structured Droid sessions run over `stream-jsonrpc` with Orca's own client (ADR 0001). Droid's runtime registration needs a `modelCatalog` discovery that lists models before any session runs, plus `restingOptions.fallbackModels` and `effortDefaultsToModel`.

Which Droid surface lists models without creating or storing a session? Candidates: `droid.list_models` before `droid.initialize_session`, a CLI listing command, or only `availableModels` on the initialize result. Does the listing include BYOK `custom:` models from Droid's settings? Does it mark the configured default model? How does it report each model's reasoning efforts?

Checked against the installed CLI, which is 0.239.0, and the `@factory/droid-sdk` 0.9.1 declarations. The ticket names 0.238.0. That binary was not installed here.

## Short answer

`droid.list_models` is the session-free listing. Call it on `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc` before `droid.initialize_session`. The result is `{ models: [...] }`. It does not write a session file and the result has no session id. Starting that exec process does create an empty `~/.factory/sessions/` directory and other startup files; that happens with no request at all.

There is no `droid models` command. `droid exec --help` prints a human catalog, including BYOK models, but its `(default)` mark is the product default (`gpt-6-sol` on this build), not the configured model. `availableModels` on `droid.initialize_session` is the same catalog, and that call stores a session.

BYOK entries from user and project `customModels` appear as `custom:<Display-Slug>-<n>`, with `isCustom: true`. The list does not mark the configured default. Each row has `supportedReasoningEfforts` and `defaultReasoningEffort`. Factory models vary (18 menus on this build). Both synthetic custom models reported only `none`.

Register a `probe`, with `listingNamesConfiguredModel: false`, `fallbackModels: () => null`, and `effortDefaultsToModel: true`. The probe has to run on the execution host. A signed-out profile still returned the built-in catalog plus local custom models.

## Findings

### What Orca asks the registration to do

A registration's `modelCatalog` is either a `probe` or `unavailable` (`src/main/native-chat/agent-model-catalog/agent-model-catalog-discovery.ts:6-16`). A probe lists models without a session, under the account a launch would pin (`src/main/native-chat/agent-model-catalog/agent-model-catalog-store.ts:51-56`). It must be built from the same command and environment the session uses (`src/main/runtime/structured-agent-model-catalog-discovery.ts:1-2`). `listingNamesConfiguredModel` is true only when that listing marks the model a new chat should launch. It is false where the agent's own settings may pick another.

`restingOptions.fallbackModels` is the list used only when the catalog has never succeeded. `effortDefaultsToModel` means an unpicked effort reads as that model's `defaultEffort` (`src/main/native-chat/agent-session-wire/structured-agent-definition.ts:14-21`, applied in `src/main/native-chat/agent-session-wire/structured-agent-session-options-read.ts:64-82`).

| Agent | Catalog | `listingNamesConfiguredModel` | `fallbackModels` | `effortDefaultsToModel` |
| --- | --- | --- | --- | --- |
| Codex | probe (`model/list`) | true, the list marks the account default | `() => null` | false, the child reports the thread's effort, not the model default |
| Claude | probe | false, settings or env can pick another model | static `seedModels()` when the CLI lists nothing | true |
| Pi | probe (`--list-models`) | false, the list marks no default | `() => null` | false |
| Grok | probe from ACP `initialize` | false | `() => null` (shared ACP definition) | false |
| OpenCode | probe from a listing command, because `initialize` names no models and `session/new` stores one | false | null | false |
| OMP | unavailable: its CLI list does not match what a chat offers | n/a | null | false |

Citations: Codex and Claude in `src/main/runtime/structured-agent-model-catalog-discovery.ts:15-37` and their definitions at `src/main/codex/codex-structured-agent-definition.ts:21-26`, `src/main/claude/claude-structured-agent-definition.ts:22-26`, `src/main/claude/claude-structured-session-options.ts:210-213`. Pi in `src/main/pi/rpc-runtime-registration.ts:64-67` and `src/main/pi/rpc-agent-definition.ts:16-20`. ACP in `src/main/acp/acp-launch-specs.ts:36-37` and `119-190`, and `src/main/acp/acp-structured-agent-definitions.ts:44-48`.

### What was compared

Installed CLI: `droid --version` → `0.239.0` (`/Users/noter/.local/bin/droid`). SDK: `npm pack @factory/droid-sdk@0.9.1` in `/tmp`, declarations only, not installed into this repo. `FACTORY_PROTOCOL_VERSION` in that package is `"1.201.1"`.

Every live call used a throwaway `HOME` under `/tmp`, `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, and no `FACTORY_API_KEY`. Settings were synthetic. No prompt was sent and no Mission was started. The first startup log line in that home said no credentials were found in the selected storage backend.

`droid --help` has no models subcommand. Commands are `resume`, `exec`, `daemon`, `search`, `update`, `mcp`, `plugin`, `computer`, `doctor`. `droid exec --help` has `--list-tools` (tools for one model, not the catalog) and no `--list-models`.

### `droid.list_models` does not store a session

Observed. The SDK's `listModels()` spawns a client and calls `droid.list_models` without `initializeSession`. The next client method, `listMcpRegistry`, throws unless a session is active. `listModels` does not. `ListModelsOptions` is only `{ includeDisabled?: boolean }`. The comment says it lists models selectable by the spawned process, and that disabled models are hidden unless `includeDisabled` is set (`package/dist/node.d.ts`, `listModels`).

The request that succeeded:

```json
{
  "jsonrpc": "2.0",
  "id": "list-1",
  "method": "droid.list_models",
  "params": { "includeDisabled": true },
  "type": "request",
  "factoryApiVersion": "1.0.0",
  "factoryProtocolVersion": "1.201.1"
}
```

The same request without `type`, `factoryApiVersion`, and `factoryProtocolVersion` was rejected with `-32700` `Invalid JSON-RPC message`. That matches the bare `droid.initialize_session` rejection on 0.238.0 in the session-protocol note.

The response envelope carried `factoryProtocolVersion` `"1.260.0"` and `factoryApiVersion` `"1.0.0"`. Result shape: `{ "models": [ ... ] }`. No `sessionId`. Before the result the process sent `droid.session_notification` whose notification type was `mcp_status_changed` (`servers`, `summary`, `type`). No session id on that notification.

After `list_models` alone, `~/.factory/sessions/` existed and was empty. No `.jsonl`. Starting `droid exec` with both stream formats and closing stdin without any request created the same empty directory, plus `host.json`, cert caches, `state/*.json`, a telemetry installation id, a log, and two markdown files under `droids/` (`scrutiny-feature-reviewer.md`, `user-testing-flow-validator.md`). Those are process startup, not the method. `--help` did not create `sessions/` or `droids/`.

Signed out, `includeDisabled: true` returned `disabled: false` on every row and no row with `disabled: true`. The SDK says the flag includes models disabled by organization policy. This profile had no organization.

### Initialize stores a session, then returns the same models

Observed, still with no prompt. `droid.initialize_session` with `machineId` and `cwd` returned `sessionId`, `settings`, `session.messages` (empty), `hostId`, and `availableModels`. It wrote:

`~/.factory/sessions/<cwd-slug>/<uuid>.jsonl`

and a sibling `<uuid>.settings.json`. The sidecar's model fields were `model`, `reasoningEffort`, and `toolExecutionModeModelId`. The files were still there after the process exited.

`availableModels` had the same ids, in the same order, as `droid.list_models` in that process. The initialize rows omitted `disabled`. The list rows included `"disabled": false`. A `settings_updated` notification followed initialize.

So `availableModels` is a listing, but it is not session-free. Do not use it as the probe.

### BYOK `custom:` models

Documented shape, from the BYOK page: `customModels[]` in `~/.factory/settings.json` (and `settings.local.json`), fields `model`, optional `displayName`, `baseUrl`, optional `apiKey`, `provider` (`anthropic`, `openai`, `generic-chat-completion-api`), optional `noImageSupport`. The settings page also lists top-level `model` and `reasoningEffort`. The docs' exec example selects `custom:<model field>`, for example `custom:deepseek-v3`.

Observed with synthetic entries (fake key, `baseUrl` `http://127.0.0.1:9/v1`, no real provider called):

| Settings | What the list showed |
| --- | --- |
| `displayName` `"Fake Local"`, `provider` `generic-chat-completion-api`, `noImageSupport` omitted | id `custom:Fake-Local-0`, `isCustom: true`, `modelProvider` `generic-chat-completion-api`, `noImageSupport: true`, no `modelId` |
| same, with `"noImageSupport": false` | `noImageSupport: false` |
| `displayName` `"Fake Anthropic"`, `provider` `anthropic`, `noImageSupport` omitted | id `custom:Fake-Anthropic-0`, `noImageSupport: false` |
| a second entry only in `<git-repo>/.factory/settings.json`, cwd set to that repo | both the user entry and `custom:Proj-Model-0` |

The canonical id is `custom:` plus a slug of `displayName` plus `-0`, not `custom:` plus the `model` field. Two different display names both used `-0`, so the suffix is not a single global counter. A collision of the same display name was not tried.

`settings.model` set to the docs-style alias `custom:fake-local` was accepted. Initialize rewrote it: `settings.modelId` came back `custom:Fake-Local-0`. The alias is an input. The catalog id is the slug.

`droid exec --help` in the throwaway home printed a `Custom Models:` block with `custom:Fake-Local-0` and the display name. The `Model details:` reasoning lines below did not include that custom model.

### The configured default is not on the row

Observed. `ListModelsResultSchema` in SDK 0.9.1 has no default-model field, and the word `isDefault` does not occur in that declarations file. On the wire, no row gained a marker when `settings.model` changed from unset, to `custom:Fake-Local-0`, to `claude-haiku-4-5-20251001`.

What did change is initialize's `settings`, which requires the call that stores a session:

| `settings.json` | `settings.modelId` | `settings.reasoningEffort` |
| --- | --- | --- |
| `model` `claude-haiku-4-5-20251001`, `reasoningEffort` `high` | `claude-haiku-4-5-20251001` | `high` |
| `model` `custom:fake-local`, `reasoningEffort` `low` | `custom:Fake-Local-0` | `none` (clamped; that row only allows `none`) |

`droid exec --help` kept `gpt-6-sol ... (default)` and `-m/--model` `default: gpt-6-sol` while settings selected Haiku. Help reads `customModels` (the custom block appeared) but its `(default)` is the product default, not `settings.model`.

The resolved choice lives on the session settings object, not in the catalog. That is the same split as Claude: the probe lists models, and a live session is what reports the configured model (`listingNamesConfiguredModel: false`).

### Reasoning efforts

Documented. The settings page says `reasoningEffort` is model-dependent, and the models page is the source of the per-model set and default. The enum in SDK 0.9.1 is `none`, `dynamic`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Observed on each `droid.list_models` row:

- `supportedReasoningEfforts`: string array
- `defaultReasoningEffort`: one of those values

Samples, which match the models page:

| id | efforts | default |
| --- | --- | --- |
| `auto` (`kind` `router`, provider `factory`) | `none` | `none` |
| `gpt-6-sol` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `medium` |
| `claude-haiku-4-5-20251001` | `off`, `low`, `medium`, `high` | `off` |
| `custom:Fake-Local-0` and `custom:Fake-Anthropic-0` | `none` | `none` |

This build had 18 distinct effort menus across 59 non-custom rows. Only `auto` had `kind: "router"`. Custom rows did not grow an effort menu when `settings.reasoningEffort` was `low` or `high`. Initialize clamped an unsupported `low` to `none`, and kept `high` for Haiku even though Haiku's own default is `off`.

`droid exec --help` prints the same facts for factory models as `Name: supports reasoning: Yes; supported: [...]; default: ...`. That text is not a stable API, and it did not print a line for the synthetic custom model.

### Fields the SDK 0.9.1 schema does not list

The published result object is `id`, `displayName`, `shortDisplayName`, `modelProvider`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `isCustom`, optional `noImageSupport`, `supportsImageGeneration`, `tier`, `tokenMultiplier`, `promoLabel`, `kind`, `variantBadge`, and either `disabled: true` plus `disabledReason` or not disabled.

Observed rows also carried, on some models: `modelId` (equal to `id` on factory rows; absent on the custom row), `deprecated`, `deprecationDate`, `featureFlag`, `isNew`, `newBadgeLabel`, `supportsPDFs`, `usesUSBasedInference`, `compactThroughLatestSignedThinking`. `tokenMultiplier` was present (`gpt-6-sol` `0.8`, `auto` `1`). A probe should read `id`, the two effort fields, `displayName`, and `isCustom`, and ignore the rest. Unknown fields are safe. Depending on the extra ones is not, until a fixture pins them.

### Recommendation

```ts
modelCatalog: {
  kind: 'probe',
  listingNamesConfiguredModel: false,
  probe: /* droid.list_models on the execution host, no initialize */
}
restingOptions: {
  fallbackModels: () => null,
  effortDefaultsToModel: true
}
```

`probe`, not `unavailable`. Unlike OMP, the session-free list is the list a session reports (`availableModels` matched ids and order). Unlike OpenCode, it does not need a command that is separate from the session protocol, and unlike Grok it must not come from initialize, because initialize stores a session.

The probe spawns `droid exec` with both formats set to `stream-jsonrpc`, on the execution host, with that host's `HOME` and the env the chat would inherit. Local, WSL, and SSH differ only in where that process runs. Custom models and `settings.model` live in that user's `~/.factory`, not in the local Mac profile. Map each row to `AgentSessionModelOption`: `id` from `id` (never `modelId`), `label` from `displayName`, `efforts` from `supportedReasoningEfforts`, `defaultEffort` from `defaultReasoningEffort`, `isDefault: false`. Do not set `supportsFastMode`. Fast variants are separate ids (`-fast`), not a toggle on the row.

`listingNamesConfiguredModel: false`. The row does not mark the configured model, and `settings.model` / project settings / an org `modelPolicy` can pick one the product default is not. A new chat must not launch `gpt-6-sol` just because help stamps it `(default)`. The configured id arrives later, on a real session's `settings.modelId`, the same way Claude learns a default its listing does not name. Do not call `initialize_session` inside the probe to discover it.

`fallbackModels: () => null`. Codex, Pi, and every ACP agent do this. Claude's static list exists because a child can come back with no models (`claude-structured-session-options.ts:210-213`). Droid's list returned models with no credentials. A hardcoded Droid list would be wrong on the next CLI (this build's product default is already `gpt-6-sol`).

`effortDefaultsToModel: true`. Every row has a default effort, and an unpicked effort should show it (`structured-agent-definition.ts:20-21`). Set it false and the at-rest pill stays empty, which is the Codex/Pi case, where the child never reports a model default. The caveat: `settings.reasoningEffort` overrides that default when the model allows the value (Haiku default `off`, settings `high`, session used `high`). That override is not on the list row. A live session has to report the resolved effort as the catalog's configured effort, which the store already prefers over the listing default. Do not write the derived `defaultEffort` back as a saved pick. That would send Haiku `off` and undo a settings value of `high`.

Signed-out does not empty the list. It also does not answer organization disables. `includeDisabled: true` is the right probe flag so a later signed-in probe can see policy-hidden rows; this run could not show one.

`daemon.list_models` and `daemon.list_custom_models` are in the same SDK file. ADR 0001 rejects the daemon as the session transport. They were not called.

### 0.238.0 versus 0.239.0

The changelog feed (https://docs.factory.com/docs/changelog/feed.json) newest CLI item is 0.237.0 (2026-10-09). `https://docs.factory.com/changelog/releases/0.238.0.json` and `0.239.0.json` both 404. Nothing in that feed through 0.237.0 says `droid.list_models` was added or removed. The method and `ListModelsResultSchema` are in `@factory/droid-sdk@0.9.1`, which the session-protocol note dates to 2026-09-04, before both CLIs.

The session-protocol note, on CLI 0.238.0, saw `availableModels` on initialize (one entry id `auto`, kind `router`) and a response protocol of `1.257.0`. This 0.239.0 run answered protocol `1.260.0`. Whether 0.238.0's `list_models` rows include the extra fields above (`deprecated`, `supportsPDFs`, and the rest) was not run. The method, the custom-model id, the missing default mark, and the two effort fields are the contract in the 0.9.1 schema, so they are not a 0.239.0-only surface. Treat the extra fields as 0.239.0 observations.

## Evidence log

- `droid --version` → `0.239.0`. `droid --help`, `droid exec --help`. No models subcommand. Help's `Available Models` / `Custom Models` / `Model details` sections, read under the throwaway `HOME` only.
- Throwaway `HOME`, `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, synthetic `customModels`, no API key. `droid.list_models` before initialize; bare request → `-32700`; initialize then observed session files; project `.factory/settings.json` in a `git init` directory. No prompt, no `--mission`.
- `npm pack @factory/droid-sdk@0.9.1`. `dist/index-C06W9tbN.d.ts`: `DroidServerMethod.LIST_MODELS` = `droid.list_models` (line 78), `daemon.list_models` (line 61139), `daemon.list_custom_models` (line 61278), `ReasoningEffort` (lines 574-584), `ModelKind` (lines 557-560), `ListModelsOptionsSchema` / `ListModelsResultSchema` (lines 3809-3837), initialize `availableModels` (lines 29270-29315) and result `settings.modelId` / `reasoningEffort` (lines 29338-29341). `dist/node.d.ts` `listModels` (lines 319 and 753-756) and `dist/node.mjs` `listModels` (no `initializeSession`). `examples/node/model-discovery.ts`.
- https://docs.factory.com/model-independence/byok — `customModels` fields and `custom:` usage.
- https://docs.factory.com/droid-cli/settings — `model`, `reasoningEffort`, `customModels`.
- https://docs.factory.com/models — per-model reasoning sets.
- https://docs.factory.com/docs/changelog/feed.json — newest item CLI 0.237.0.
- Orca: files and lines in Findings. ADR `docs/adr/0001-structured-droid-sessions-use-stream-jsonrpc.md`.

## Open questions

- Signed in, with an org `modelPolicy`, does `includeDisabled: true` return the hidden rows and a `disabledReason`, or does the list shrink? This profile was signed out on purpose.
- Does `settings.local.json`, a folder `.factory/`, or org-managed settings change the list, or only the model initialize resolves? Only user `settings.json` and a project `customModels` array were executed. Project `model` overriding user `model` was not.
- Two `customModels` entries with the same `displayName`: the `-0` suffix looks like a disambiguator. A collision was not created.
- CLI 0.238.0 was not executed. The extra row fields and protocol `1.260.0` are 0.239.0 observations. The 0.9.1 schema is the 0.238.0 claim.
- `daemon.list_models` was not called.

## Confidence

| Finding | Confidence |
| --- | --- |
| `droid.list_models` before initialize returns the catalog and does not write a session `.jsonl` | high |
| `droid.initialize_session` writes a session and returns the same ids | high |
| No machine-readable CLI list; help `(default)` is the product default | high |
| BYOK rows use `custom:<Display-Slug>-0`, `isCustom`, and reasoning `none` | high for the cases run; medium for the suffix rule under a display-name collision |
| The list does not mark `settings.model`; initialize's `settings.modelId` does | high |
| Per-model `supportedReasoningEfforts` and `defaultReasoningEffort` | high |
| `probe`, `listingNamesConfiguredModel: false`, `fallbackModels: null`, `effortDefaultsToModel: true` | high as a reading of these types against the observations |
| Org-disabled rows, and that 0.238.0's row fields match 0.239.0 | not determined |
