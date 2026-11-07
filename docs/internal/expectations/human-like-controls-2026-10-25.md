# Expectation contract: human-like controls, stable MCP, truthful latency

Status: verified (2026-10-25). Source: user request in OmO session
`01a173e1-53b8-7f6d-9524-eaa632439ff0` (prompt-builder + loe), read against the
current working tree and the prior evidence in
`.omo/evidence/mcp-active-stability/` and
`.omo/plans/cua-improvements-2026-10-23.md`.

## Outcome / intended user

A host agent (OmO/senpi, Codex, Claude Code, pi, OpenClaw, Hermes) can drive
one app's keyboard, pointer, and vision work in one call with human-like
overlap, receive truthful per-call latency and session usage, and keep the MCP
connection through long or busy native work without routinely reconnecting.
The person at the Mac keeps focus, can stop all input, and sees no new
instability.

## Goal or milestone

Extend the existing guarded desktop control surface without replacing its
native macOS core: make concurrency explicit and safe, make the MCP session
self-observing and resilient, and make latency/usage visible to the model.
This is outside the older "parallax/worker" milestone only in the sense that it
adds intra-app hand coordination; it reuses the same background/attended
delivery, observation-token, and stop-switch contracts.

## In scope

1. MCP supervisor hardening: answer health pings before initialization, avoid
   `notifications/tools/list_changed` when a restart exposes an identical tool
   list, and keep long calls alive with MCP progress notifications when the
   client asked for progress.
2. Always-on, model-visible `timing_ms` on every tool result, plus a read-only
   `get_tool_usage` summary of this session's calls, errors, bytes, and p50/p95/max
   latency.
3. A `run_hands` batch for one observed app: a keyboard lane, a pointer lane,
   and an optional vision capture, scheduled by resource ownership so
   compatible work overlaps and conflicting work serializes.
4. Measured decision on Rust: add none unless a measured hotspot or a
   cross-platform requirement justifies it.

## Out of scope

- Rewriting core, MCP, browser, or agent packages in Rust or Go.
- A second physical OS pointer, independent cursor, or virtual display.
- Changing the signed helper, its Info.plist, or its launcher.
- Host-side OmO heartbeat code in another repository. Server-side mitigation
  only; the existing host patch remains an external dependency.
- New runtime dependencies.
- Replaying actions after an uncertain outcome.

## Constraints and compatibility

- Existing tools and their sequential semantics stay intact; `run_steps` and
  `run_parallel` keep their current behavior.
- Background delivery may overlap keyboard and pointer work because input is
  addressed to the target window. Attended delivery must serialize
  focus-sensitive lanes unless the caller explicitly requests an unsafe overlap
  and the scheduler can prove the resources disjoint.
- Stop switch and client cancellation apply to every lane and every event.
- One-use observation tokens, window guards, preflight, and post-action
  observation remain mandatory.
- The repository conventions apply: strict TypeScript, tabs, ESM `.js`
  imports, `import type`, no `any`/`@ts-ignore`, Vitest `#given #when #then`,
  deterministic tests without fixed sleeps, Biome.
- Tool list budgets from `docs/expectations/parallel-background-cua.md`:
  full <= 32,000 bytes, lean <= 10,500 bytes. This change measured 34,556 bytes
  for the full list after `run_hands` and `get_tool_usage`, so the full cap is
  revised to 35,000 bytes as a recorded proposed threshold; lean remains 10,500
  (measured 9,734). The step schema is still published once.

## Requirements

| ID | Requirement and source | Starting state + action | Pass observable | Evidence |
|---|---|---|---|---|
| EXP-001 | A busy native call must not force a reconnect (user: MCP unstable; prior supervisor finding) | Initialize through the supervisor, start a call, block the child, ping from the client | The ping answers from the supervisor before the child responds; the connection stays initialized; the blocked call later completes or fails honestly | supervisor test with a held child + live SIGSTOP probe (`.omo/evidence/human-controls-2026-10-25/live-mcp.json`) |
| EXP-002 | A restart with an unchanged tool list must not announce a false change (user: reconnect churn) | Re-initialize a supervised child with an identical `tools/list` result | No `notifications/tools/list_changed`; a changed list still sends it | supervisor test |
| EXP-003 | Long work keeps the request alive when progress was requested (user: tool calls take too long) | Call a slow tool with a progress token | At least one `notifications/progress` arrives before completion; the final result is unchanged | protocol test with a held fake tool |
| EXP-004 | Every tool result carries truthful timing (user: latency not reported) | Call observation, mutation, inventory, and error tools | `timing_ms.total` is present, >= 0, and roughly matches the handler duration; existing phase fields survive | protocol tests + measured live result (`live-mcp.json`, `live-hands.json`) |
| EXP-005 | Agents can read session usage (user: usage not reported) | Make a known mix of successful and failed calls, then call `get_tool_usage` | Counts match; errors are counted; p50/p95/max and bytes are numeric; no screenshot/token is required | protocol test + live `usageCalls: 2` (`live-mcp.json`) |
| EXP-006 | Human-like background overlap (user: left/right hands) | `run_hands` with a gated keyboard lane and a gated pointer lane on one app in background delivery | Both lanes start before either finishes; `overlap_ms` > 0; both effects are present; final observation token is returned | protocol test with Deferred gates + live hands (`overlap_ms: 442`) |
| EXP-007 | No unsafe overlap in attended delivery (user: overlap only when required) | Same `run_hands` call in attended delivery | Lanes are serialized; overlap_ms = 0; both effects still occur in declared order | protocol test |
| EXP-008 | Same-element/focus conflict is refused or serialized (user: no overlap unless required) | Keyboard lane types into the focused field while pointer lane clicks the same element, or attended focus is shared | The scheduler serializes the conflict; no lost keystroke or double click; the result names the conflict policy | unit scheduler test + protocol test |
| EXP-009 | Vision can run with input (user: keyboard + vision + mouse together) | `run_hands` with `vision.include_screenshot=true` and an input lane gated open | Vision capture starts before input finishes, returns an image or an honest unavailable note, and the input effect still applies | protocol test with a state gate + live capture (`live-hands.json`) |
| EXP-010 | Stop safely ends both hands (user safety) | Trigger the stop switch during a long keyboard lane and a pointer lane | No later input is sent; held keys/buttons are released; result is partial/refused with the reason; both lanes report their last state | protocol test with injected stop source |
| EXP-011 | Existing behavior is preserved (compatibility) | Run the existing observation, run_steps, run_parallel, and mutation suites | No new failures; sequential paths produce the same effects | focused Vitest suites + full Vitest 221 files / 2,436 passed, 2 skipped |
| EXP-012 | Rust only on evidence (user constraint) | Profile observation, input, JSON, FFI, and scheduler overhead | A written decision names the measured share; Rust is added only if a single hotspot is >20% of p50 tool latency and >10 ms, or a cross-platform requirement appears | benchmark output + decision note |
| EXP-013 | Tool surface stays bounded (existing project cap) | List tools for full and lean profiles after `run_hands`/`get_tool_usage` | Full <= 35,000 bytes (measured 34,556; revised from 32,000), lean <= 10,500 (measured 9,734) | tools/list measurement; `.omo/probes/human-controls-2026-10-25/tool-bytes.ts` |
| EXP-014 | No dependency or native regression | Run workspace typecheck, focused tests, Biome, and scoped builds | Exit 0; no new runtime dependency; no change to signed-helper inputs | workspace typecheck 6/6, test typecheck, script tests 40/40, Biome 613 files, scoped MCP/core builds |

## Assumptions

- "Usage" in the request means tool-call usage and latency visible to the model;
  token accounting belongs to the client, not this server. `get_tool_usage`
  reports server-side calls, errors, bytes, and latency so the interpretation is
  explicit.
- A human-like overlap is an overlap of *logical hand lanes*, not two OS
  pointers. The native hardware cursor remains singular, consistent with
  `docs/expectations/parallel-background-cua.md`.
- Existing background input already addresses events to the target window and
  does not move the person's cursor; this is the safe basis for overlap.
- The prior supervisor ping fix and host-side patch are real but not sufficient
  for every client; EXP-001..003 cover the remaining server-side observable
  behavior.

## Open decisions and affected IDs

- None blocking. The overlap default (`auto`), Rust threshold, and usage shape
  are proposed here and will be recorded with measurements. If the user wants a
  different policy, only EXP-006..008 and EXP-012 change.

## Evidence ledger (2026-10-25)

- Contract and plan: this file; `.omo/plans/human-like-controls-2026-10-25.md`.
- Supervisor: `packages/mcp/src/supervisor.test.ts` 33/33; live busy-child probe
  `.omo/probes/human-controls-2026-10-25/reconnect-probe.mjs` answered ping in
  ~0.3 ms while the child was stopped, then resumed the call.
- Timing/usage: `tool-timing.test.ts` 8/8; full MCP suite 63 files / 646 tests
  passed at the time of the run; `timing-heartbeat.protocol.test.ts` 1/1.
- Hands: `packages/core/src/computer/hands.test.ts` 18/18;
  `hands.protocol.test.ts` 6/6 (background overlap, attended serialization,
  vision concurrency, `always` refusal, stop switch, usage).
- Rust: `.omo/evidence/human-controls-2026-10-25/rust-decision.md`; scheduler
  overhead ~3.5 us/run for two lanes.
- Live MCP: `.omo/evidence/human-controls-2026-10-25/live-mcp.json` - ping answered
  in 0.3 ms while the child was stopped, timing present, `run_hands` and
  `get_tool_usage` registered, usage reported 2 calls.
- Live hands: `.omo/evidence/human-controls-2026-10-25/live-hands.json` - a
  task-owned fixture accepted a pointer click (293 ms), then keyboard typing and a
  concurrent vision capture overlapped by 442 ms; typed value verified, image
  captured (30,021 bytes), total 696.8 ms.
- Whole gates: workspace typecheck 6/6; `typecheck:tests` exit 0; script tests
  40/40; Biome 613 files clean; full Vitest 221 files / 2,436 passed, 2 skipped
  (75.56 s); `git diff --check` clean.
- Consolidated report: `.omo/evidence/human-controls-2026-10-25/report.md`.

## Residual limits

- The live fixture was a task-owned regular AppKit app; iPhone Mirroring and
  destructive desktop journeys were not re-run.
- The host-side OmO request-timeout/reconnect patch remains outside this
  repository. The server side now answers pings and emits progress; a client that
  still reconnects on a lost response must be fixed in that client.
- No Rust is added. Revisit only under the conditions in
  `.omo/evidence/human-controls-2026-10-25/rust-decision.md`.
- Full tool-list cap is 35,000 (measured 34,556), revised from 32,000 and recorded
  in the plan and existing parallel-background contract.

## Done when

Every required EXP has evidence from a protocol/unit test or a live probe, the
focused suites and workspace typecheck pass, the measured tool-list and latency
numbers are recorded, and any residual host-side or native limitation is named
with its exact evidence path.
