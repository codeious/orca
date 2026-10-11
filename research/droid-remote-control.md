# What do Remote Control and Droid Computers expose?

## Question

What are `droid computer register|remove|list|ssh|port-forward`, `droid daemon --remote-control`, and Droid Computers as Mission targets? What protocol and authentication do they use, which parts depend on Factory's cloud, and can a third-party client attach to a remote Droid session or Mission?

Checked against Droid CLI 0.238.0 (`droid --version`), Factory docs, Factory Public API OpenAPI 0.1.0, and `@factory/droid-sdk@0.9.1`. No machine was registered, no daemon was started, and no SSH, port-forward, Mission, or model call was made.

## Short answer

Remote Control is a registration of a computer you already run. Factory-managed Droid Computers are different machines that Factory provisions. Both are reached through Factory's relay, not by opening an inbound port.

A third party with a Factory API key can list computers at `https://api.factory.ai/api/v0/computers`. For selected organizations only, it can create and drive a session on a `computerId`. There is no public Missions API. The Factory App can start a Mission on a Droid Computer; the sessions API accepts `interactionMode: "mission"` but does not document orchestrator behavior.

`droid computer ssh` and `port-forward` are TCP over that relay. They do not work without Factory's cloud. A daemon started without `--remote-control` is only a local WebSocket or IPC server. Reaching it takes your own SSH port forward, not Droid's.

## Findings

### Two products share one CLI

**Published.** Factory-managed Droid Computers are persistent hosts Factory provisions (4 CPU, 8 GB RAM, 6 GB swap, user `factory-user`). Remote Control connects a Linux, macOS, or Windows machine the customer already administers. The docs tell you to use Remote Control instead of a Droid Computer when you want your own machine.

Sources: [Droid Computers](https://docs.factory.com/droid-computers/overview), [Remote Control](https://docs.factory.com/remote-control).

`droid computer` is help-texted as "Manage Remote Control registrations" and has only `register`, `remove`, `list`, `ssh`, and `port-forward` (`droid computer --help`, Droid 0.238.0). The docs use the same commands for both managed computers and Remote Control machines.

### What the CLI commands are

**Published, help and docs.**

| Command | Contract |
| --- | --- |
| `droid computer register [name]` | Registers this machine. Name defaults to the hostname. `-y` skips prompts and auto-clears stale local config. |
| `droid computer remove` | Removes this machine's registration and cleans local config. `-y` skips confirmation. One registration per computer. |
| `droid computer list` | Lists registered computers. Docs say the output shows name, ID, status, and which row is the current machine. Help has no `--json` or other output flag. |
| `droid computer ssh <name>` | Opens SSH. `--proxy` is a stdio `ProxyCommand`. `--port` defaults to `22`. `--debug` exists. |
| `droid computer port-forward <name> <mappings...>` | Forwards local TCP to the computer. `LOCAL:REMOTE`, `REMOTE`, or `:REMOTE` (random local port). `--address` defaults to `127.0.0.1`. Docs say only TCP. |
| `droid daemon --remote-control` | Connects this computer to Factory's relay. `--remote-access` is an alias. If the machine is not registered, the daemon prompts for a name and registers it. |

`droid daemon` without that flag is a local server: `--host` defaults to `127.0.0.1`, `--port`, `--unix`, and `--listen websocket|ipc` (default `websocket`). `--software-factory-workstream <uuid>` restricts a worker pool. Nothing in daemon help selects a remote computer.

Sources: `droid computer --help` and each subcommand's `--help`; `droid daemon --help`; [Remote Control](https://docs.factory.com/remote-control); [CLI reference](https://docs.factory.com/droid-cli/cli-reference); [Droid Computers, CLI and port forwarding](https://docs.factory.com/droid-computers/overview).

### Protocol and what needs Factory's cloud

**Published.** No inbound port is required. With `--remote-control`, the computer makes an outbound connection to `relay.factory.ai` (non-EU) or `relay.eu.factory.ai` (EU), and it also needs Factory APIs. `droid computer ssh` is a WebSocket tunnel through that relay, not a direct SSH port. Port-forward uses the same tunnel. Managed computers can be woken before the tunnel comes up. Relay mode for managed computers can also be forced at the org so public traffic is blocked.

Factory generates an Ed25519 key pair under `~/.factory/.ssh/`, separate from personal keys, and injects the public key on each connection. The published VS Code `ProxyCommand` example uses `User factory-user`, `IdentityFile ~/.factory/.ssh/id_ed25519`, and `UserKnownHostsFile ~/.factory/.ssh/known_hosts`. That username matches the account created while provisioning a managed computer. The computer object also has `remoteUser` (below). The Remote Control page does not say the SSH user on a customer-owned machine is `factory-user`.

**Not published.** The relay WebSocket frame format, how `relayClientUrl` / `relayAgentUrl` are dialed, and the SSH user used for a Remote Control machine.

Sources: [Remote Control, before you start and security](https://docs.factory.com/remote-control); [Droid Computers, SSH and security](https://docs.factory.com/droid-computers/overview); [EU deployment](https://docs.factory.com/enterprise/network-and-deployment).

### Public HTTP API

**Published.** Factory Public API 0.1.0, server `https://api.factory.ai`, bearer auth with a Factory API key or JWT. Spec: [openapi.json](https://docs.factory.com/openapi.json). Group pages: [computers](https://docs.factory.com/api-reference/computers), [sessions](https://docs.factory.com/api-reference/sessions), [API overview](https://docs.factory.com/api-reference). The EU API host `api.eu.factory.ai` is documented for EU orgs, but it is not a server in this OpenAPI file.

Computers (16 operations). A client can:

- `GET /api/v0/computers` and `GET /api/v0/computers/{computerId}` and `GET /api/v0/computers/name/{name}`. Optional `hostId`, `serviceAccountId` (human Manager or higher), `includeProvisioningSteps`, `includeUnlisted`.
- `POST /api/v0/computers`. Required field is `name`. Optional: `provider`, `hostId`, `remoteUser`, `repos` (up to 20 URIs), `autoInstallDeps`, `serviceAccountId`, `source` (`template`, `execution-template`, with an optional Software Factory draft receipt). The description says managed computers return in `provisioning` and finish asynchronously, while computers registered through Remote Control use an existing machine and are `active` immediately. Replaying a saved draft receipt returns the existing computer.
- `POST /api/v0/computers/bulk` creates up to 20 managed computers. Not a Remote Control path.
- `PATCH` name, `remoteUser`, or a not-yet-set `hostId` (`hostId` is immutable once set).
- `DELETE` a managed computer shuts down the host and archives its sessions. `DELETE` of a Remote Control computer removes the registration and leaves the machine and its sessions intact. Automations on the computer are paused.
- `GET .../providers` returns `e2b`, `opencompute`, or `tensorlake`. `byom` is not in that list. It is the example `providerType` for a computer you brought.
- `POST .../activity`, `POST .../restart`, and `GET .../metrics` are not supported for Remote Control. `POST .../refresh` does not modify a Remote Control computer and returns zero counts. Metrics fields are `timestamp`, `cpuUsedPct`, `cpuCount`, `memUsed`, `memTotal`, `diskUsed`, `diskTotal`.
- File upload and download URLs, and `install-deps`, are on the computer resource. The docs do not say they work on Remote Control machines.

A computer object requires `id`, `name`, `providerType`, `createdAt`. Optional fields include `hostId`, `isListed`, `status` (`provisioning` | `active` | `error`), `provisioningSteps`, `relayClientUrl`, `relayAgentUrl`, `remoteUser`, `clonedRepoDirectories`, `ownerPrincipalKind`, `ownerId`, `computerSource`.

Sessions (9 operations), every one marked "enabled for selected organizations only":

- `POST /api/v0/sessions` requires `computerId` ("Computer ID to connect"). Optional `cwd` and `sessionSettings`.
- `sessionSettings.interactionMode` is `auto` | `spec` | `agi` | `mission`. Also model, reasoning, autonomy, tools, tags, and worktree. There is no mission id, worker model, or validator model field.
- `GET /api/v0/sessions?computerId=` lists sessions. `GET` and `DELETE` of one session take optional `computerId` ("query directly").
- `POST /api/v0/sessions/{sessionId}/messages` sends text, images, and files. Optional `computerId` overrides the session's computer. The response is `messageId` plus `status` (`idle` | `pending` | `running`). The prose says the call optionally waits for completion; the OpenAPI body has no wait flag and the 200 body is not the agent result.
- `POST .../interrupt` and `PATCH` of `sessionSettings` exist. `GET .../messages` can filter `role` to `user`, `assistant`, or `tool`.

No path in the 42-operation spec is a Mission, relay, or daemon resource.

**What a third party can do with this contract.** List and manage computer records, and on an entitled org create a session bound to a computer and send messages to it. That is request/response over HTTPS, not a documented WebSocket attach to a running TUI or Mission.

**What it cannot do from this contract.** Open the relay, open SSH, port-forward, read Remote Control metrics, restart a Remote Control machine, or address a Mission as its own resource.

### SDK

**Published package, partly undocumented in the guide.** `@factory/droid-sdk@0.9.1` ([npm](https://www.npmjs.com/package/@factory/droid-sdk), guide [TypeScript SDK](https://docs.factory.com/sdk/typescript)). The guide says the root entrypoint connects to an existing daemon and that the daemon client uses a Factory API key. It does not mention computers, Remote Control, or Missions. The declarations do.

REST helpers in the root entrypoint call `/api/v0/computers`, `/api/v0/computers/name/`, and `/api/v0/sessions` (strings in `dist/chunk-TWSTJMV7.mjs`): `listComputers`, `getComputer`, `getComputerByName`, `createComputer`, `updateComputer`, `deleteComputer`, `restartComputer`, `refreshComputer`, `getComputerMetrics`, `retryInstallDeps`, `listRemoteSessions`. Each takes `apiKey` and optional `baseUrl`. `listRemoteSessions` takes `computerId?`, `limit?`, `cursor?`.

`ComputerSchema` in that package is narrower than OpenAPI and passthrough: `id`, `name`, `hostname?`, `providerType` (`byom` | `e2b` only), `status?`, `createdAt`, `relayClientUrl?`, `remoteUser?`. `CreateComputerOptions.provider` is only `'byom' | 'e2b'`, and `remoteUser` is required there. OpenAPI's create body requires only `name`, and its provider list includes `opencompute` and `tensorlake`. The HTTP spec is the wider contract.

`connectToDaemon({ url, auth: { apiKey } })` returns a client whose `sessions.create` / `sessions.resume` speak to that daemon. `DEFAULT_LOCAL_DAEMON_WS_URL` is `ws://localhost`. Daemon auth parameters accept a Factory API key (`fk-*`) or a WorkOS JWT `token`, plus an optional act-as grant. `DaemonAuthenticationMode` is `token` | `trusted`. On a connected daemon, `relay.start()` / `stop()` / `status()` return `relayUrl`, `computerId`, `connected`, `url`, and `clientCount`. `ssh.installKey(publicKey)` returns `{ installed }`. `missions` on that client is only `inspectReadiness(cwd)` and `acknowledgeReadinessWarning(cwd)`.

`WebSocketDaemonTransportConfig` has `isRelayConnection` and comments that `relay.authenticate` sends an org id for a backend ownership check. That is a type comment, not a relay protocol spec.

The browser examples pass a caller-supplied `daemonUrl` and an API key. The README says not to put that key in a public website.

### Missions on a computer

**Published, App and CLI only.** In the Factory App, starting a Mission can target a Droid Computer so the work runs on that machine instead of the local workspace ([Running in the Factory App](https://docs.factory.com/missions/running-app)). `droid exec --mission` runs Mission mode in the CLI process. Its help has worker and validator model flags and no computer flag (`droid exec --help`, Droid 0.238.0). Mission settings are local model and policy keys, not a computer id ([Missions reference](https://docs.factory.com/missions/reference)).

**Published enum, behavior undocumented.** `sessionSettings.interactionMode` may be `"mission"` on `POST /api/v0/sessions`. The spec does not say this starts the orchestrator, workers, and validators described in the Missions docs.

### Authentication and account implications

**Published.**

- Remote Control from the CLI requires an interactive Factory login (`/login`) before `droid daemon --remote-control`.
- HTTP and the SDK REST helpers use a Factory API key or JWT (`Authorization: Bearer`). Keys are created at `https://app.factory.ai/settings/api-keys`.
- `settings.json` key `remoteAccessEnabled` (boolean, default `false`) is "Allow this machine to be used for remote Droid Computer access." It sits under Infrastructure, not under the enterprise table ([Settings](https://docs.factory.com/droid-cli/settings)).
- Org-managed, marked Enterprise, default `false`: `byomComputersEnabled` ("Allow members to register their own computers for Remote Control via `droid computer register`"), `byomComputersAllowedEmails`, `managedComputersEnabled`, `managedComputersAllowedEmails`. The docs say individual users should not expect to change these.
- If the Droid Computers settings page is missing, the Remote Control page says to contact a Manager, Owner, or Factory support.
- `serviceAccountId` on computer calls is for a human Manager or higher looking up a service account's computers. Daemon auth types describe an act-as grant for a Manager driving a service-account-owned daemon.
- Managed computers can receive the user's Factory GitHub credentials. Remote Control uses whatever git credentials are already on that machine. Factory does not manage them.
- Deleting a Remote Control registration does not delete the machine or its sessions. Deleting a managed computer does shut it down and archives sessions.

**Undocumented local files, this install only.** Key names, not values. `~/.factory/computer.json`: `computerId`, `registeredAt`. `~/.factory/host.json`: `schemaVersion`, `hostId`, `createdAt`, and `computerRegistration` with `computerId`, `firestoreOrgId`, `userId`, `registeredAt`. Read from the Droid 0.238.0 install. Not a published schema.

### What works without Factory's cloud

**Published.** `droid computer ssh` and `droid computer port-forward` both use the relay. They do not work with no route to `relay.factory.ai` or `relay.eu.factory.ai`. Remote Control's own page says the daemon connects through that relay.

**Published, and it is not Remote Control.** `droid daemon` without `--remote-control` binds `127.0.0.1` (or a `--unix` socket, or `--listen ipc`). `connectToDaemon` can attach to a WebSocket URL you can already open, with an API key. An SSH session you opened yourself can forward that local port. That is your SSH, not `droid computer port-forward`, and it does not register a Droid Computer. Airgapped Droid is documented as running with no Factory cloud by using your own model endpoints ([Deployment patterns](https://docs.factory.com/enterprise/network-and-deployment)). That does not extend to Remote Control, which names the relay as a requirement.

**Not established.** Whether a daemon that is up without Factory reachability still accepts `connectToDaemon` when the API key cannot be checked online. Not tested.

## Evidence log

- `droid --version` → `0.238.0`. `droid --help`, `droid computer --help`, `droid computer register|remove|list|ssh|port-forward --help`, `droid daemon --help`, `droid exec --help`. No subcommand was run without `--help`.
- Docs fetched 2026-08-14: [remote-control.md](https://docs.factory.com/remote-control.md), [droid-computers/overview](https://docs.factory.com/droid-computers/overview), [cli-reference](https://docs.factory.com/droid-cli/cli-reference), [missions/running-app](https://docs.factory.com/missions/running-app), [missions/reference](https://docs.factory.com/missions/reference), [api-reference](https://docs.factory.com/api-reference), [computers](https://docs.factory.com/api-reference/computers), [sessions](https://docs.factory.com/api-reference/sessions), [sdk/typescript](https://docs.factory.com/sdk/typescript), [settings](https://docs.factory.com/droid-cli/settings), [network-and-deployment](https://docs.factory.com/enterprise/network-and-deployment). `docs.factory.ai` pages for computers and Remote Control resolve to the same `docs.factory.com` articles.
- `https://docs.factory.com/openapi.json`, OpenAPI 3.0.1, info version 0.1.0, 42 paths. Downloaded and inspected locally. No live API call.
- `npm pack @factory/droid-sdk@0.9.1` into `/tmp/wayfinder-droid/remote-control-tmp` (not the repo). Types in `package/dist/index-C06W9tbN.d.ts`; path strings in `package/dist/chunk-TWSTJMV7.mjs`; README in the tarball.
- Key names only from `~/.factory/computer.json` and `~/.factory/host.json`.

## Unknowns and risks

- Relay WebSocket handshake and frames are not specified. `relayClientUrl` and `relayAgentUrl` are opaque strings in the computer object. A client that is not `droid computer ssh` or the Factory App has no published way to attach that tunnel.
- `interactionMode: "mission"` is not documented as starting a Mission. There is no public mission id, worker list, or Mission Control API.
- Sessions API entitlement ("selected organizations only") was not tested.
- SDK `ComputerSchema` / `CreateComputerOptions` disagree with OpenAPI (`hostname` vs `hostId`, provider enum, `remoteUser` required only in the SDK). Calling create through the SDK can reject providers the HTTP API lists.
- `droid computer list` has no documented machine-readable output. The HTTP list is the published structured contract.
- SSH username for a Remote Control machine is not stated. `factory-user` is documented for Factory-provisioned computers.
- It is not shown that `droid computer register` is `POST /api/v0/computers`. The API describes that outcome; the CLI help does not name the endpoint.
- `~/.factory/computer.json` and `host.json` were observed on one install. Keys may differ by version. `firestoreOrgId` and `userId` mean a registration file is tied to a Factory account; the file format is not a supported API.
- `remoteAccessEnabled` and `--remote-control` are both published and not documented as the same switch.
- Nothing here was executed against a live relay, daemon, or API.

## Confidence per finding

| Finding | Confidence |
| --- | --- |
| CLI flags and subcommands match Droid 0.238.0 help | High |
| Remote Control is outbound to `relay.factory.ai` or `relay.eu.factory.ai`; ssh and port-forward use that relay; TCP only | High |
| Managed Droid Computers are Factory-provisioned and a separate option from Remote Control | High |
| Public computers and sessions HTTP shapes, bearer auth, and the selected-org gate on sessions | High |
| No public Mission, relay, or daemon REST resource | High |
| Factory App can target a Droid Computer for a Mission; `droid exec --mission` has no computer flag | High |
| `interactionMode: "mission"` starts a full Mission on that computer | Low |
| SDK REST helpers wrap `/api/v0/computers` and `/api/v0/sessions` | High |
| SDK daemon client attaches to a URL you already have, with an API key; it does not dial Remote Control by computer name | High |
| Relay frame protocol and a third-party attach through `relayClientUrl` | Low (not published) |
| Local `computer.json` / `host.json` key names on this install | High for this machine, low as a stable contract |
| Own SSH to a daemon that was not started with `--remote-control` does not use Factory's relay | High |
| That local daemon still accepts clients while Factory is unreachable | Low (not tested) |
