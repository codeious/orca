---
status: accepted
---

# Structured Droid sessions use stream-jsonrpc through Orca's own client, not ACP

Orca drives a structured Droid session over Droid's `stream-jsonrpc` protocol (`droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc`), with a dedicated Droid adapter. Orca spawns and supervises the `droid` process itself, and speaks the protocol through its own JSON-RPC peer. `@factory/droid-sdk` is used only for its published types and contract tests, never at runtime. We chose this because `stream-jsonrpc` is the surface Factory documents as Droid's full control API, and the Missions work needs it anyway. Grok, OpenCode, and OMP are each one ACP launch-spec row, so Droid looks like the odd one out. That difference is deliberate.

## Considered Options

- **One more ACP launch-spec row (`droid exec --output-format acp`).** Rejected. Factory publishes no ACP method catalog for Droid. Its permission and AskUser flows over ACP are unverified, and a question Orca cannot answer leaves a session waiting forever. On 0.238.0, Droid's ACP mode did not advertise compact, rewind, or fork. Missions would need `stream-jsonrpc` anyway, which means a second Droid adapter.
- **ACP now, stream-jsonrpc later for Missions.** Rejected: two Droid adapters and two sets of fixtures.
- **`droid daemon` over its local websocket.** Rejected. It is undocumented, it is shared with other clients, and Droid's auto-update restarts it. Undocumented Droid formats are allowed only as version-gated, read-only fallbacks.
- **The SDK's `DroidClient` at runtime, over an Orca-supplied transport.** Rejected. It adds a second JSON-RPC layer next to Orca's peer, plus zod v3 beside Orca's v4, the MCP SDK, and OpenTelemetry. The SDK's protocol version also lags the CLI's (1.201.1 against 1.257.0 on Droid 0.238.0).
- **The SDK spawning `droid` itself.** Rejected because it would bypass `@orca/process-host` on Windows and Orca's exit-proof supervision.

## Consequences

- Orca's JSON-RPC peer (`AcpJsonRpcPeer`) takes a dialect (`src/main/acp/acp-peer-dialect.ts`): it mints request ids, shapes each frame written, reads each inbound record, and names the errors the peer raises. Droid's dialect (`src/main/droid/droid-json-rpc-peer.ts`) is the second one. It uses string ids and adds `type`, `factoryApiVersion`, and `factoryProtocolVersion` to every frame. Factory's raw JSON-RPC doc example, which leaves those fields out, is rejected by Droid 0.238.0.
- The minimum Droid version is the release that Orca's captured fixtures and real-CLI test pass against (0.238.0 when this was decided), and it is raised deliberately. An older Droid opens a Droid terminal session instead.
