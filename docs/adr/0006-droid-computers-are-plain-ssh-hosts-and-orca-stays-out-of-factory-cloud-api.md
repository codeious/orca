---
status: accepted
---

# Droid Computers are plain SSH hosts, and Orca stays out of Factory's cloud API

Orca reaches a Droid Computer or a Remote Control machine only as an ordinary SSH host, through `ProxyCommand droid computer ssh <name> --proxy`. It adds no host kind, calls none of Factory's cloud API, stores no Factory API key, and never registers or removes a computer or starts `droid daemon --remote-control`. Listing, registering, and managing computers stay in the Factory App and `droid computer`. We chose this because both kinds of machine are reachable only through Factory's relay, whose frames are unpublished, and the HTTPS API needs a key that Orca, which does not manage Factory accounts, would have to hold. Orca's SSH layer already honors a `ProxyCommand`, so everything decided for SSH hosts applies with no new code.

## Considered Options

- **A `droid-computer` host kind beside `local`, `ssh`, and `runtime`.** Rejected. It would need Orca to dial Factory's relay, whose frame format is not published, or to call the cloud API for names and status. Every reader of host ids would gain a new case, and the SSH route needs neither.
- **Listing computers through Factory's HTTPS API with a user-supplied key.** Rejected. Orca does not manage Factory accounts, and the sessions half of that API is limited to selected organizations.
- **Listing computers by parsing `droid computer list`.** Rejected. It has no machine-readable output, so the format would be an undocumented contract.
- **Starting a Mission on a computer through the sessions API (`interactionMode: "mission"`).** Rejected. Factory documents no Missions API and no orchestrator behavior for that value, so Orca could not follow or steer the result.
- **Orca registering a machine or starting the Remote Control daemon.** Rejected. A registration ties a machine to the user's Factory account and organization policy, so it is the user's act, in Droid's own login.
- **A Droid Computer preset in the add-host dialog.** Rejected for now. Factory does not publish the SSH user for a Remote Control machine, and a name list would need the listing Orca does not do. Documentation carries the `~/.ssh/config` snippet, and the existing SSH config picker imports it.
- **A direct SSH fallback when the relay is unreachable.** Rejected. Remote Control machines expose no inbound port, and an organization can force relay mode on managed computers.

## Consequences

- A Mission Orca starts in a Droid terminal session on such a host is an owned Mission (ADR 0005). A Mission started in the Factory App is an observed Mission if Orca's reader finds its files on that host, and invisible otherwise. Orca offers no "attach to Mission" or "start Mission on computer" action.
- A session the Factory App starts on a computer has no live attach. Orca cannot tell whether Factory still writes to it, so Resume works as for any session on an SSH host and asks for confirmation unless the session is known finished.
- When the relay is unreachable, the host shows the existing SSH disconnected state and error. Terminals kept by the Orca relay on the machine live on for their grace period, and their verdict is `unverifiable`, never `exited`. Orca adds no Factory-specific state.
- Persisted host ids stay `local`, `ssh:*`, and `runtime:*`. There is no migration and no wire change for older mobile and web peers.
- The route is unverified end to end, including relay deploy onto each kind of machine. A task ticket checks it on a real machine.
- Revisit this decision if that check fails, or if Factory publishes the relay protocol or a Missions API.
