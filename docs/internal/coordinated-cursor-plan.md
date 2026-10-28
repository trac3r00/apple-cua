# Coordinated, vision-aware apple-cua

## Users and ideal state

The person using the Mac must be able to keep working while automation runs behind
their windows. Background delivery must produce no cursor, highlight, or click
ripple and must leave their real pointer and foreground app untouched.

The coordinating agent owns the overall task and verification. It delegates
bounded tasks to workers with distinct cursor identities and non-overlapping app
ownership. Workers observe their own target, act using current observation
tokens, and return verified outcomes. Cursor artwork is an indicator, not another
operating-system mouse.

The agent inspecting an unfamiliar interface needs both accessibility semantics
and pixels. Screenshot coordinates must be explicitly grounded in the observed
window, with element frames mapped into that image. Partial trees and unavailable
images must remain explicit; neither is permission to invent controls.

Visible attended cursors must move continuously, retarget from their current
position, land at the requested hotspot, respect reduced motion, and preserve
exact tracking for already-paced gestures.

## Evidence and initial gaps

- `packages/core/src/platform/macos.ts` chooses an overlay independently of
  delivery. `macos-input.ts` also accepts a visible overlay for background input.
  Existing background tests explicitly expect cursor artwork.
- `packages/core/src/platform/macos-ffi/cursor-motion-config.ts` leaves trajectory
  planning disabled by default. Native discrete movement uses a fixed-duration
  glide, while paced input uses exact `track` samples.
- `packages/mcp/src/parallel-tools.ts` batches independent apps but has no worker
  task assignment or cursor ownership contract.
- `packages/mcp/src/guarded-session.ts` already scopes one-use observations to
  app/window context and maps image coordinates into logical screen coordinates.
  Preserve these guards rather than introducing an unguarded input path.
- `packages/mcp/src/tool-result.ts` returns accessibility frames and optional
  images, but does not present an explicit image-to-element grounding contract.

## Execution checklist

- [x] Suppress all background overlay paths, including injected overlays, while
  preserving logical pointer state and targeted input.
- [x] Improve visible discrete motion using the existing planner, retain exact
  gesture tracking, and verify retargeting and reduced motion.
- [x] Implement coordinator-owned bounded worker assignments using existing
  guarded app lanes, with distinct worker/cursor identity and conflict handling.
  Keep model spawning in the host agent rather than embedding a model provider.
- [x] Expose explicit screenshot coordinate grounding and element-image mapping
  without claiming inaccessible pixels have accessibility semantics.
- [x] Update usage instructions with one coordinator, bounded workers, fresh
  observations, vision fallback, and independent outcome verification.
- [x] Run focused regression tests, repository checks, native build, and
  real-surface QA. Record exact evidence and remaining gaps here.

Execution uses independent small workers with disjoint file scopes. Shared MCP
registration changes follow implementation modules sequentially. A verification
wave consumes all producer changes. No commits are authorized.

### Implementation topology

1. Background visibility: `macos.ts`, `macos-input.ts`, and their regression tests.
2. Visible motion: motion configuration, native overlay animation, and adjacent
   motion tests. Independent of background visibility.
3. Cursor scope: after background visibility, add an async-flow cursor identity
   context, route overlay transports and logical pointer state by that identity,
   and export the context for the MCP coordinator.
4. Coordinator: after cursor scope, expose assignment/status/release management
   and guarded worker execution. Assignments resolve approved app PIDs, reject
   overlapping ownership, carry worker/task/cursor identities, and own their
   observation tokens. All actions still use `GuardedSession.runSteps`; attended
   delivery remains serialized. The host agent spawns language-model subagents;
   this server supplies their bounded execution and cursor ownership.
5. Vision: independently enrich MCP observation output with coordinate-space
   metadata and test the OCR-only guarded click route. Native window observations
   already map element frames to image pixels; preserve these frames rather than
   applying a second transform. Preserve existing JSON/table contracts.
6. Integration verification consumes all five lanes and runs repository checks.
   Native visual QA follows on the integrated build.

Each producer is a small `quick` worker with its tests. These are disjoint lanes
except for the explicit background -> cursor scope -> coordinator chain. One
coordinator supervises this graph; no persistent agent team is needed.

## QA contract

1. Background construction and direct input-controller use never send a visible
   overlay command, including observation highlights, semantic presses, pointer
   motion, scroll, click cues, and recovery from errors. Targeted input and
   logical pointer position continue to work.
2. Attended movement still draws a cursor, lands at the target, retargets from
   the visible position, and uses exact samples for paced gestures. Reduced
   motion avoids decorative travel.
3. A coordinator assigns two distinct tasks to two distinct app workers. Each
   result identifies its worker, task, app, and cursor. Conflicting assignments
   are rejected before input. Same-app work and attended input remain serialized.
4. Workers cannot act with another worker's observation context. Cancellation
   and stop-switch behavior remain effective.
5. A scaled, offset window observation maps element frames to screenshot pixels
   accurately. Missing images, partial trees, off-image elements, and capture-only
   observations do not manufacture actionable targets.
6. MCP protocol tests exercise the actual registered tool surface. Native QA
   captures and inspects the visible overlay and confirms background absence.
7. `pnpm check` and `pnpm build` exit successfully, or an unrelated existing
   failure is recorded without weakening its check.

## Evidence ledger

- Installed locked dependencies with `pnpm install --frozen-lockfile` (exit 0)
  and built core TypeScript exports required by MCP protocol tests (exit 0).
- New visual metadata regressions first failed because `visual_context` was
  absent. After implementation, visual result, OCR grounding, motion config,
  motion planner, and motion socket suites passed: 5 files, 83 tests.
- Native AX frames are already screenshot-relative; OCR frames are global logical
  points. `visual_context` now distinguishes them, records full/partial/diff-only/
  capture-only coverage, and supplies image-to-screen scale and origin only when
  an image is actually present.
- The OCR protocol test clicks image-only `row-03` in an offset, scaled window:
  global point `(520, 490)`, PID `1234`, window `71`. It verifies the click's
  resulting field value. A second case refuses an AX value write to OCR-only text.
- A new injected-background-overlay observation regression failed on an actual
  highlight call. The host now ignores injected overlays in background mode,
  while the input controller preserves logical position without visual commands.
  Background/observation/input suites then passed: 4 files, 74 tests.
- Native overlay captures show the real artwork and movement, including retarget
  from `(371, 260)` rather than the previous goal. Native `hide` reports
  `shown: false`; the human pointer remained exactly
  `(438.76953125, 437.94140625)`. Task-owned native processes exited cleanly.
  Follow-up native samples reached exactly `(550, 300)` and stayed there.
  Rapid window-only captures intermittently returned empty or cropped frames;
  three paired stable window/screen captures all showed complete cursor artwork.
  This capture limitation is not counted as evidence of smoothness. Movement,
  interrupted retargeting, stable artwork, and exact landing were checked
  separately.
- Coordinator review found two real regressions: observation feedback lacked the
  worker cursor identity, and refreshing a named app could migrate its task to a
  replacement PID. Both tests failed before correction. Observations now run
  under the worker cursor scope, app ownership is pinned, assignment batches
  remain busy until all observations succeed, and status omits cached images.
  Coordinator regression suite: 7 tests passed.
- Real native background QA used two task-owned Cocoa app windows, each with an
  editable field, Apply button, and result label. Two assigned workers ran
  concurrently with different cursor UUIDs. Both outcomes were independently
  read back as verified, `effect: confirmed`: `native alpha` in PID `52213`,
  window `1801`; `native beta` in PID `52216`, window `1800`. Both returned real
  screenshots and the image coordinate contract.
- During those native tasks, the human pointer remained exactly
  `(379.9296875, 585.921875)`, the foreground app stayed `com.apple.Terminal`,
  and the list of cursor-overlay processes stayed empty. Both fixture processes
  were stopped and their task-owned `/tmp/apple-cua-native-qa-01a15006-9710-7c77`
  directory was removed after the QA run.

## Final QA matrix

Evidence root: `.omo/evidence/ulw/01a15006-9710-7c77-bb50-43ddd8ee480f`.

| Scenario | Expected and observed | Verdict | Evidence |
| --- | --- | --- | --- |
| Two native background workers | Independent edits and Apply clicks read back correctly; human pointer, foreground app, and zero-overlay inventory unchanged | PASS | `native-background-result.json` |
| Default attended cursor API | No override, real daemon, sampled continuous motion, exact endpoint, complete visible artwork, human pointer unchanged, daemon/socket scratch cleaned | PASS | `native-default-cursor.mjs`, `native-default-result.json`, `default-cursor.png` |
| Interrupted motion and reduced motion | Actual current hotspot used; pure planner golden cases, reduced-motion and exact gesture tracking retained | PASS | Motion/input suites in `final-checks.txt`; native retarget captures under `native-cursor/` |
| Worker ownership and cancellation | PID aliases conflict, foreign/stale tokens refuse input, observations retain cursor identity, app relaunch cannot migrate claims, busy release refuses, cancellation stops later steps, attended workers serialize | PASS | Nine coordinator tests and three registered worker protocol scenarios in `final-checks.txt` |
| Vision grounding | AX image pixels and OCR screen points distinguished; offset/scaled OCR-only click reaches observed PID/window and readback verifies outcome; OCR text cannot authorize AX value writes | PASS | `vision-grounding.protocol.test.ts`, `tool-result.test.ts`, full run in `final-checks.txt` |
| Discoverability and efficiency | Worker op/assignment fields published; images remain image blocks; runtime step validation precedes dispatch; existing 40 KB catalog limit retained | PASS | `catalog-result.json`, compact-schema and worker protocol tests |
| Compatibility and compilation | Lint, workspace/test typechecks, 1511 tests and 21 script tests pass; full native/workspace build succeeds | PASS | `final-checks.txt` |

### Resolved integration gaps

- The final gate found that direct background movement still emitted a pointer
  mode command through an injected overlay. Movement now suppresses that command;
  the existing silent-feedback regression covers both click and move.
- Assigned workers now refresh through `manage_workers(op: "observe")`, not
  `get_app_state`, so their successor tokens stay owned by `run_worker`.
- Defaulting the shared environment parser changed CLI configuration identity.
  Adaptive motion now defaults only at overlay creation; optional saved settings,
  explicit off/null overrides, and registration idempotence retain their contracts.
- Worker steps reuse strict runtime validation instead of duplicating the entire
  action catalog. The manager publishes a flat discoverable schema and validates
  each operation before changing state. Repeated script API prose was condensed
  without changing script execution. The final full catalog is 39,903 bytes.
- An automatic LSP formatter conflicted with pinned Biome formatting. A temporary
  project-local override was removed after applying pinned formatting; no lint or
  typecheck rule was disabled. An invalid-byte PNG fixture was replaced with its
  exact eight-byte PNG signature.

### Remaining boundaries

No requested implementation item is deferred. The host supplies the main model
and spawns language-model workers; all assigned workers share one MCP server
session. Virtual cursors remain indicators, not independent OS mice. Vision
provides grounded observations and OCR fallback, not invented semantics for
inaccessible controls.

Two existing opt-in live tests were not enabled: the model decision-endpoint test
and the deliberately unresponsive-app AX timeout test. Neither replaces the
real native worker and cursor QA performed here. No commits or external writes
were made.
