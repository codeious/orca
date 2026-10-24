---
status: accepted
---

# Droid's Spec mode travels as the agent-neutral `planMode` session option

Orca's chat turns Droid's Spec mode on and off through a new optional session option, `planMode`. It is a boolean, encoded like `fastMode`, and a client sets it the same way it sets a model or effort pick. The Droid adapter translates it to Droid's `interactionMode` (`spec` or `auto`) and reports it back from Droid's `settings_updated`. In a Droid session the toggle is labelled "Spec". The key is agent-neutral because Orca's journal already records plan approval as an agent-neutral `plan` subject, and Claude has the same concept in its `plan` permission mode, which could adopt the key later. Once clients read this key, renaming it means carrying both names across mixed-version clients and hosts, so the name is fixed here.

## Considered Options

- **A Droid-only key, `interactionMode`.** Rejected. It copies Droid's wire vocabulary, which also carries `mission`, into Orca's option set, and the next agent with a plan mode would need a second key and a second toggle.
- **A `/spec` command that Orca intercepts.** Rejected. It is hidden, and it gives clients no state to show.
- **No Spec control in session core.** Rejected. Droid cannot enter Spec mode by itself, so Spec mode would be unreachable in a structured Droid session.

## Consequences

- `planMode` is a new optional field in the session options result and a new key for `setOption`. Clients show the toggle only when the host reports the field, so a newer client never offers it against an older host. Older clients ignore it and still answer plan approvals, because the `plan` subject is a kind they already draw.
- The pick is saved like a model pick, so a session that goes to rest in plan mode resumes in plan mode.
- When the user approves a plan, Droid leaves Spec mode, and the toggle follows what Droid reports.
