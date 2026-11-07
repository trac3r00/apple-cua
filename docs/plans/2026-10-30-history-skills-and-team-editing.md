# History skills and team editing

## Order and acceptance contract

- O1: Make cua-history work like the documented Codex history-to-skill flow.
  The person can open history from the menu bar, inspect recorded sessions,
  generate readable summaries and workflow suggestions, review a real generated
  skill, and save it without overwriting an existing skill. A missing model or
  missing evidence must be an explicit error, not a fabricated draft.
- O2: Find optimization alternatives for agents with their own plans and goals,
  non-overlapping assignments, and collaborative document editing. Deliver a
  source-backed capability matrix, recommended architecture, and concrete QA
  scenarios. Do not equate logical cursor identities with independent OS input.

## Users and ideal state

The primary user reviews desktop history and chooses reusable workflows without
reading JSONL or invoking terminal commands. The consuming agent receives a skill
with inputs, evidence-backed steps, and outcome checks, not a raw event dump.
The coordinator can see every worker's goal, dependencies, owned resources,
progress, and verified output. Workers cannot overwrite a teammate's work.

## Verified starting state

- Revision: `7f4e0f8ab3df896c7eabf687ffeafd8a2598fbe0`.
- The checkout already has substantial unrelated and uncommitted changes,
  including the history recorder. Preserve those changes; do not commit.
- `packages/core/native/history-recorder.m:450`: controls only, no timeline.
- `packages/cli/src/history-commands.ts`: start, stop, pause, resume, status only.
- `packages/mcp/src/history-tools.ts`: five control/status tools, no drafting.
- `skills/cua-history/SKILL.md:62`: summaries are agent-written, not automatic.
- `packages/mcp/src/worker-coordinator.ts:14`: task text, app, worker identity.
  Assignment is exclusive per PID, not per document section.
- Public reference: OpenAI Computer History documents timeline suggestions;
  Record & Replay separately documents demonstration-to-skill creation.

## Design

Use a local loopback history interface opened by the existing menu-bar recorder.
Keep recording and UI separate so a model failure cannot stop collection.
Use the installed OmO CLI for tool-free, ephemeral inference through stdin;
the interface must disclose that generating a summary or draft sends selected
history to the configured model. Never enable automatic inference silently.
Retain structured summaries separately from expiring raw events. Save a reviewed
skill only on an explicit UI action, using exclusive file creation.

A terminal-only exporter would not satisfy O1. A second full native recorder
would duplicate capture and permission logic. The chosen design reuses capture,
adds the missing review surface, and confines model access to selected evidence.

## Checklist

- [x] Inspect local history surfaces and documented Codex behavior.
- [x] Inspect worker ownership and obtain external collaboration alternatives.
- [x] Implement bounded history reading, summary/draft validation, and safe save.
- [x] Implement tool-free model invocation with bounded output and cancellation.
- [x] Implement local history UI and authenticated loopback routes.
- [x] Connect the menu-bar action and CLI entry point in source.
- [x] Run deterministic generated cases and calibrate the rejection oracle.
- [x] Exercise timeline, real-model drafting, save and errors on synthetic evidence.
- [x] Complete real-model digest verification and suggestion handoff on synthetic history.
- [x] Complete demonstration UI and responsive layout verification on synthetic history.
- [ ] Optional follow-up: verify native replay after the user resumes computer use.
- [x] Deliver collaboration alternatives and an evidence-labelled audit.
- [x] Install and verify the rebuilt CLI and recorder after explicit user approval; see `docs/evidence/history-skills-2026-10-30/ROLLOUT.md`.

## Ownership and coordination

The main session coordinates delivery, owns integration, and independently
verifies results. Research workers are read-only and have finished. Implementation
workers, if used, receive exact disjoint file scopes and return test evidence.
Background completion uses the host's task notifications and RPC subscription.
No worker may commit, install into the live user environment, or edit real user
documents. Failed workers are inspected before replacing their work.

## FDD budget and oracle

Use Vitest and deterministic generated cases, not coverage-guided fuzzing.
Exercise valid Unicode, empty/truncated/malformed JSON, invalid paths, duplicate
names, oversized evidence, and uncertain model output. Exact counts and replay
commands must be recorded after execution. Expected values come from explicit
schemas and filesystem postconditions, not encode/decode self-consistency.
Calibrate with a deliberately invalid draft and confirm rejection before save.
Use synthetic fixtures, bounded case counts, no fixed sleeps, and teardown for
all task-owned files and processes.

## Collaboration alternatives to evaluate

1. Existing per-app workers with a structured coordinator plan.
2. Native cloud coauthoring in separate editor/input contexts.
3. App-native API edits to exclusive document sections, cells, or slides.
4. Isolated drafts and a single verified integrator.

Required scenarios: concurrent disjoint edits survive in the final artifact;
overlapping writers queue or reject before mutation; stale revisions cannot
silently overwrite; failed workers release claims only after input stops;
cursor labels match workers; keyboard input reaches the intended context; and
the completed document is visually inspected. No claim of live collaboration
passes on unit tests alone.

## Evidence limits

No live Codex UI comparison, real document coauthoring, or latency improvement
has been measured in this session. The existing expectation document is a plan,
not fresh evidence. The source implementation has not replaced the installed
recorder. Native replay was refused by the user's existing computer-use stop
switch; no input was dispatched and the switch was not changed.
