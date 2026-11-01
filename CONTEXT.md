# Orca

Orca is a desktop workspace for running coding agents side by side. This glossary fixes the words used when Orca runs Droid, Factory's coding agent.

## Language

### Ways Orca runs Droid

**Droid terminal session**:
Droid's own terminal interface running in an Orca terminal pane, with Orca reading its status from the outside.
_Avoid_: Droid TUI session, Droid pane

**Structured Droid session**:
A Droid session Orca drives itself and shows in Orca's own chat, including approvals, questions, and model choice.
_Avoid_: Droid native chat, Droid headless session

**Launch mode**:
Which of the two a new Droid launch gets, a structured Droid session or a Droid terminal session. It comes from the user's settings, and Orca falls back to the Droid terminal session when the host cannot run a structured one.
_Avoid_: launch surface, launch route

**Chat UI switch**:
Orca's single global setting that makes new launches of supported agents open as structured sessions. It is off by default, and a per-agent setting can override it for Droid.
_Avoid_: native chat switch

**Droid floor**:
The oldest Droid release Orca runs a structured Droid session on. An older Droid gets a Droid terminal session.
_Avoid_: minimum version, version gate, supported version

**Session holder**:
The Droid terminal session or structured Droid session that has a Droid session open and may write to it. Orca allows one at a time, among the holders it can see.
_Avoid_: session lock, session owner, writer

**Fork**:
A copy of a Droid session under a new id, with its full history and a link to its parent, that leaves the original untouched. Orca offers a fork only as a Droid terminal session, never in its own chat. It is not the terminal menu's Fork Agent Session, which starts a fresh agent with captured context.
_Avoid_: branch, clone

**Lead session**:
The one Droid session in a Droid terminal session's pane that the pane's row speaks for: the session the user talks to, which runs a Mission while one is active. Mission workers, Mission validators, and subagents in the same pane are child sessions, and their events never change the row's own state, prompt, tool, or resume identity. A different `droid` process in the same pane never takes the role.
_Avoid_: main session, root session, orchestrator session

**Background child**:
A child session still working after its lead session has stopped its turn. It keeps the row from reading done until it ends.
_Avoid_: detached child, orphan child

### Session controls

**Autonomy level**:
How much Droid may do without asking: Off, Low, Medium, or High.
_Avoid_: autonomy mode, auto level

**Plan mode**:
A state in which an agent only researches and proposes a plan, and changes nothing until the user approves the plan.
_Avoid_: planning mode, read-only mode

**Spec mode**:
Droid's name for plan mode, and the label Orca shows for it in a Droid session.
_Avoid_: spec interaction mode

### Missions

**Mission**:
Factory's orchestration run for large, multi-feature work: a plan of features grouped into milestones, carried out by Droid agents.
_Avoid_: Droid job, Droid run

**Mission Control**:
Orca's view for following and steering a Mission.
_Avoid_: Mission dashboard, Mission panel

**Mission detail**:
What Orca reads about a Mission from its files: the plan, the workers' handoffs, the progress log, and the models. Whether the Mission is running comes from its terminal and hooks, not from this.
_Avoid_: Mission data, Mission info

**Mission worker**:
A Droid agent inside a Mission that builds one feature.
_Avoid_: Droid worker, mission agent

**Mission validator**:
A Droid agent inside a Mission that checks a finished feature or milestone.
_Avoid_: Mission tester, QA agent

**Owned Mission**:
A Mission running in a Droid terminal session in an Orca pane, however it was started. Orca follows it, steers it, and says whether it is still running. It stays owned only while it runs there; resumed anywhere else, it becomes an observed Mission.
_Avoid_: Orca Mission, managed Mission

**Observed Mission**:
A Mission Orca finds on a host but does not run, such as one started in the Factory App or in a terminal outside Orca. Orca only reads it and never steers it.
_Avoid_: foreign Mission, external Mission

**Paused Mission**:
A Mission that Droid has paused, at a retry or iteration limit or on the user's request, and that waits for a message to continue. Its terminal may still be alive or may have exited.
_Avoid_: stopped Mission, halted Mission

**Interrupted Mission**:
An owned Mission whose files say it was running but whose terminal's `droid` is proven gone, because the terminal was closed, the app crashed, or the process was killed. It can be resumed. It is not a Paused Mission, which Droid itself has paused.
_Avoid_: stalled Mission, crashed Mission, dead Mission

### Machines Factory can reach

**Droid Computer**:
A machine Factory provisions and hosts for the user. Orca reaches it as an SSH host.
_Avoid_: Droid VM, cloud computer, bare "computer"

**Remote Control machine**:
A machine the user already runs and has registered with Factory so Factory's tools can reach it. Orca reaches it as an SSH host, and never registers it.
_Avoid_: BYOM computer, registered computer, Droid Computer (for a machine the user owns), bare "computer"

### Orca's own orchestration

**Orca worker**:
An agent that Orca itself supervises as part of its own orchestration. It is unrelated to a Mission worker.
_Avoid_: Worker (unqualified)
