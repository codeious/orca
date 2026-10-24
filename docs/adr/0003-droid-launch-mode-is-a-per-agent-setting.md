---
status: accepted
---

# Droid's launch mode is a per-agent setting that overrides the Chat UI switch

Whether a new Droid launch opens as a structured Droid session or a Droid terminal session is decided by a per-agent launch setting, with Orca's single global Chat UI switch as its fallback. The setting is a map in global settings, keyed by agent id, and only Droid's row is shown for now. Its values are *Follow Chat UI switch* (the default), *Terminal*, and *Chat*. *Terminal* keeps Droid in a terminal while the switch is on, and *Chat* gives a structured Droid session while the switch is off. We chose this so a user can pick Droid's surface independently of Claude and Codex. The Droid terminal session stays for good, because SSH and WSL workspaces always get it.

## Considered Options

- **The Chat UI switch alone.** Rejected. One switch moves every supported agent at once, so a user cannot keep Droid in a terminal, or try Droid chat, without changing Claude and Codex too.
- **A Droid-specific key, such as `droidLaunchSurface`.** Rejected for the reason in ADR 0002. Once clients read a key, renaming it means carrying both names across mixed-version peers, and the next agent would need a second key.
- **A per-launch "open as terminal" action for every agent.** Rejected for now. It changes a decision that no caller overrides today, and it is a cross-agent feature rather than a Droid one.
- **Only two values, with *Terminal* as the default.** Rejected. Users who already have the switch on would stay on the terminal until they opted in, and the migration rule is that nothing is converted and Droid follows the switch.
- **A terminal opt-out only.** Rejected. The switch would still gate chat, so Droid chat could not be tried with the switch off.

## Consequences

- The setting enters through the shared launch-route policy, so the host's launch-mode decision and the renderer's route both read it, and every launch path honours it: renderer tab, mobile create, CLI create, and orchestration worker. The shared settings type is read by many callers, so run blast-radius before changing it.
- The feasibility rules are unchanged. SSH, WSL, a Droid below the version floor, a host that is not ready, a custom start directory, or a reused terminal still give a Droid terminal session, and the launch receipt records why.
- The receipt reason `user_default` says "the default for new agent tabs in your settings". It needs a sibling reason that names the per-agent setting, so a downgrade message points at the setting the user actually changed.
- Older peers ignore the new field. An older host has no Droid registration, so it keeps opening a Droid terminal session.
- Explicit chat requests ("Resume in new chat") and the floating terminal ignore the setting, as they already ignore the switch.
- Running and sleeping Droid terminal sessions are never converted. With the default value, only users who already have the switch on see a change: their new Droid launches become structured once Droid meets the version floor.
