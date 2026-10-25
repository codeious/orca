---
status: accepted
---

# Droid's launch mode is a per-agent setting that overrides the Chat UI switch

Whether a new Droid launch opens as a structured Droid session or a Droid terminal session is decided by a per-agent launch setting, with Orca's single global Chat UI switch as its fallback. The setting is a map in global settings, keyed by agent id, and only Droid's row is shown for now. Its values are _Follow Chat UI switch_ (the default), _Terminal_, and _Chat_. _Terminal_ keeps Droid in a terminal while the switch is on, and _Chat_ gives a structured Droid session while the switch is off. We chose this so a user can pick Droid's surface independently of Claude and Codex. The Droid terminal session stays for good, because SSH and WSL workspaces always get it.

## Considered Options

- **The Chat UI switch alone.** Rejected. One switch moves every supported agent at once, so a user cannot keep Droid in a terminal, or try Droid chat, without changing Claude and Codex too.
- **A Droid-specific key, such as `droidLaunchSurface`.** Rejected for the reason in ADR 0002. Once clients read a key, renaming it means carrying both names across mixed-version peers, and the next agent would need a second key.
- **A per-launch "open as terminal" action for every agent.** Rejected for now. It changes a decision that no caller overrides today, and it is a cross-agent feature rather than a Droid one.
- **Only two values, with _Terminal_ as the default.** Rejected. Users who already have the switch on would stay on the terminal until they opted in, and the migration rule is that nothing is converted and Droid follows the switch.
- **A terminal opt-out only.** Rejected. The switch would still gate chat, so Droid chat could not be tried with the switch off.

## Consequences

- The setting enters through the shared launch-route policy, so the host's launch-mode decision and the renderer's route both read it, and every launch path that can open a chat honours it: renderer tab, floating terminal, mobile create, and the local orchestration worker. `orca worktree create --agent` and a federated worker are terminal launches by contract (each returns a terminal handle), so they stay terminals; the CLI has no other way to start an agent. The shared settings type is read by many callers, so run blast-radius before changing it.
- The feasibility rules are unchanged. SSH, WSL, a Droid below the version floor, a host that is not ready, a custom start directory, or a reused terminal still give a Droid terminal session, and the launch receipt records why.
- The receipt reason `user_default` says "the default for new agent tabs in your settings". It needs a sibling reason that names the per-agent setting, so a downgrade message points at the setting the user actually changed.
- An older host has no Droid registration, so it keeps opening a Droid terminal session. Reading the new field is safe on any peer, but `settings.update` is a strict schema: an older host rejects a whole update that carries `agentLaunchModes`. Nothing sends it over the wire today (desktop writes through local `settings.set`), so any future sender must be capability-gated.
- Explicit chat requests ("Resume in new chat") ignore the setting, as they already ignore the switch.
- The floating terminal follows the setting as it follows the switch, like any workspace. The first draft said it ignores both; the code already routes it through the same launch decision, and a special case for Droid alone would split one agent from the rest.
- Running and sleeping Droid terminal sessions are never converted. With the default value, only users who already have the switch on see a change: their new Droid launches become structured once Droid meets the version floor.
