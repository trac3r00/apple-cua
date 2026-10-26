# Expectation contract: interactive latency budget

Status: superseded in part by the 2026-10-26 hot-session and deferred-outcome
results at the bottom of this file; the original 2026-10-25 contract follows.
Source: user request in OmO session
`01a173e1-53b8-7f6d-9524-eaa632439ff0`: "I want all calls to be less than 200ms
... the tool call to be happening parallel and working along all together." On
2026-10-26 the same user asked for a different approach: "좀 다른 방안, 방식을
생각해봐. 무조건 속도 존나 빨라야 함." and approved tracks A (hot-session workers),
B (deferred outcome), and C (native stream) with A+B first.

## 2026-10-26 results: deferred outcome + hot-session frames

Two architecture changes landed (no native changes, no build beyond the
core `tsgo` emit needed for cross-package declarations):

1. **Deferred outcome (B)**: `run_hands` input-only calls skip the post-action
   result read by default (`outcome: "live"` opts back in). A bounded
   accessibility-event settle (quiet 30 ms, deadline 100 ms) replaces it, the
   answer labels itself `outcome: "deferred"`, and the next token's element ids
   are honestly marked as predating the action. A failed or stopped lane falls
   back to a live read.
2. **Hot-session frames (A)**: an engaged session (idle-stop 2 s) runs a
   worker-thread refresher that re-captures the bound window continuously;
   vision calls answer from the latest warm frame (`source: "hot"`,
   `frame_age_ms`, max age 300 ms) instead of a one-shot capture. A missing
   frame waits up to 250 ms for the refresher's next frame before any
   main-thread capture, and a refresher that stops delivering is dropped and
   respawned on the next call.

Measured on the same task-owned fixture (5 warm reps, source `GuardedSession`),
quiet machine:

| Shape | 2026-10-25 | 2026-10-26 | Contract |
|---|---:|---:|---|
| click deferred | 155.5 / 157.5 | **122.8 / 123.5** | <= 200: PASS |
| type deferred | 134.8 / 145.4 | **132.8 / 132.9** | <= 200: PASS |
| vision (hot frame, deferred) | 232.3 / 260.2 | **24.1 / 24.3** | <= 200: PASS |
| type+vision (hot frame, deferred) | 217.2 / 217.7 | **130.2 / 131.8** | <= 200: PASS |
| vision live (hot capture, live read) | 232.3 / 260.2 | 35.5 / 36.2 | <= 200: PASS |

All four interactive shapes now pass the 200 ms p50/p95 contract; the vision
floor was removed by the speculative refresher rather than argued around.
Caveats, measured honestly:

- Frame ages ran 184-283 ms under load, near the 300 ms freshness budget.
- The one-shot SCK capture loop degrades under sustained heavy system load
  (load average 8-10 from unrelated processes): the same shapes measured
  130-470 ms in a later run. Absolute numbers track machine load; the
  structural win (no mandatory read, no per-call capture) holds.
- Track C (persistent SCStream in `native/sckit.m`) removes the per-capture
  session churn entirely and is the next step if sustained-load numbers
  matter; the user's 2026-10-26 selection includes it.

Deferred semantics (B) also apply to vision calls: a vision-only deferred call
returns the capture with no tree read at all. Element ids on a deferred token
predate the action, matching the existing fast-pace contract; observe again
before element actions that depend on the result.

Verification for the 2026-10-26 changes: full MCP suite 66 files / 671 tests
with **668 passed** (only the pre-existing `native-policy.test.ts` spy
failures), MCP and core typechecks clean, Biome clean on all touched files,
`hot-frames.protocol.test.ts` (5) and `deferred-outcome.protocol.test.ts`
(12) deterministic tests passing, and two live source-executed measurement
suites under `.omo/probes/hot-session-2026-10-26/`.

## 2026-10-25 original contract
## Result in one line

`run_hands` **click-only** and **type-only** now pass the 200 ms p50/p95
contract. **Vision-only** and **type+vision** are named native long calls: their
measured 200 ms floor is caused by synchronous `getAppState` AX/screenshot
calls, which block the event loop even when their promises are started
together. They are reported against their own budgets and are not counted as
fast-path successes.

## Before / after on the same task-owned fixture

Before: `packages/mcp/dist/server.js` under Node 26, on a temporary task-owned
regular-activation AppKit fixture built from `scripts/fixtures/background-input.swift`
(the fixture was removed after measurement), 5 warm runs per shape after one
warm round. Evidence: `profile-dist.json`.

After: source `GuardedSession` handler under Vitest/Node with source aliases
(`@apple-cua/core` -> `packages/core/src/index.ts`), same fixture, same shape
order. Evidence: `live-final.out` and `profile-source-live.json`.

| Call | Before p50 / p95 | After p50 / p95 | Contract |
|---|---:|---:|---|
| `run_hands` click-only | 200.0 / 202.2 | **155.5 / 157.5** | <= 200: PASS |
| `run_hands` type-only | 336.2 / 350.3 | **134.8 / 145.4** | <= 200: PASS |
| `run_hands` vision-only | 261.4 / 299.9 | 232.3 / 260.2 | native long call, 300 ms budget |
| `run_hands` type+vision | 420.6 / 434.4 | 217.2 / 217.7 | native compound long call, 250 ms budget |

The after numbers are `GuardedSession` handler time, the same handler the MCP
tools invoke, without MCP transport/serialization. The 200 ms headroom on
click/type is more than the transport cost observed on the dist MCP profile.
The typed field value was read back after the type-only call and contained
`warm`; the complete value is in `profile-source-live.json`.

## Measured phase floors

- Click: pointer dispatch 9.9-29.8 ms warm; final AX read 105-126 ms;
  preflight 19.9-28.4 ms; baseline/after window probes 20-25 ms each.
- Type: keyboard dispatch 2.4-28.6 ms with `settleWrite:false` on the final
  write; final read 103-123 ms; preflight 19.6-28.4 ms.
- Vision: screenshot/AX capture 168-265 ms while overlapping the final read,
  and the final AX read 168-247 ms. `getAppState` is synchronous native work;
  starting the capture and outcome read together does not make their native
  calls overlap. This is the measured 232 ms p50 floor on this host.
- Type+vision: write dispatch 16.7-28.6 ms, vision capture 99.6-127.2 ms,
  final read 101.9-125.7 ms. `overlap_ms` is 97-113 ms between the keyboard
  lane and capture; the two native reads still serialize on the event loop.
- `APPLE_CUA_TIMING=1` labels every phase used above
  (`windowProbe.before/after`, `preflightInput`, `hands.*.dispatch`,
  `hands.vision.capture`, `hands.coordinator`, `readOutcome.getAppState`).

## In scope

- `run_hands` click-only and type-only in background delivery on one observed
  app, with one-use observation tokens and a bounded result.
- The fast path for `click`, `type_text`, and `press_keys` when their existing
  result shape is requested.
- Parallel starting of independent baseline, action, vision, and outcome work.
- Per-phase timing in the result and in `APPLE_CUA_TIMING=1` logs.
- Safety: observation token, preflight, window guard, stop switch, no replay.

## Named long calls (not fast-path failures)

- `vision_capture_native`: vision-only requires a screenshot capture and an AX
  outcome read; p50 232.3, p95 260.2, 300 ms budget. The floor is the native
  synchronous read, not queueing or duplicate work.
- `type_with_vision`: the write plus both native reads; p50 217.2, p95 217.7,
  250 ms budget. The compound call is not a single interactive input call.
- Explicit waits and verification polling, `expect.timeout_ms`, full-tree or
  screenshot observations, `open_app`, permission prompts, OCR, `run_script`,
  iPhone Mirroring, UTM, and browser navigation retain their named budgets.

## Changes that produced the result

- One preflight per `run_hands`; the first lane step uses the cheap window
  identity check, while later steps keep the full guard.
- The baseline window listing starts before `beginMutation`; the post-action
  listing runs concurrently with the final AX read. Text-only calls skip both
  listings because a text write cannot open or close a window.
- Fast outcome reads cap the diff walk at 250 elements while full/retain reads
  remain uncapped.
- The bound window is read from the token's map; no `boundWindowOption` probe.
- A closed bound window is dropped from the baseline listing instead of a
  second probe.
- The final result read is taken once. Checks run against it; polling happens
  only when an expectation fails and a timeout was supplied.
- A final `type_text` with no `expect` skips its write-settlement fence; earlier
  writes and writes followed by dependent steps keep it.
- The outcome read is started when input lanes settle, so vision capture and
  the final AX read are both in flight; native calls still serialize.

## Verification

- `packages/mcp/src/latency-fast-path.protocol.test.ts` (7 tests): one preflight,
  second-step preflight retention, baseline/preflight overlap, final-write
  settlement, one post-action verification read, vision/outcome overlap, and
  no window listing on the text-only path.
- `field-updates.protocol.test.ts` updated for the capped fast diff read.
- Full MCP suite: 64 files / 654 tests with **651 passed**; the only failures
  are three pre-existing `native-policy.test.ts` mock-spy assertions that also
  fail when that file runs alone and are unrelated to this change. Focused
  8-file / 85-test run passed; MCP and core typechecks passed; Biome check
  passed on all touched files.
- Live source evidence: `pnpm exec vitest run --config
  .omo/probes/latency-budget-2026-10-25/vitest.live.config.ts` with
  `FIXTURE_PID=<task-owned fixture pid>`; 1 live test passed and wrote the
  final JSON.
- No `pnpm build` and no commit were run; the dist baseline predates these
  source edits.

## Evidence paths

- `docs/expectations/latency-budget-2026-10-25.md` (this contract)
- `.omo/evidence/latency-budget-2026-10-25/profile-dist.json` (before)
- `.omo/evidence/latency-budget-2026-10-25/live-final.out` (after phases)
- `.omo/evidence/latency-budget-2026-10-25/profile-source-live.json` (after summary)
- `.omo/evidence/latency-budget-2026-10-25/mcp-full.out` (651/654 suite result)
- `.omo/probes/latency-budget-2026-10-25/live-latency.test.ts`,
  `vitest.live.config.ts` (source execution harness)

## Done when

- Click-only and type-only pass at p50 and p95 <= 200 ms with typed-value proof.
- Vision-only and type+vision either pass 200 ms or report the exact native
  floor, named budget, and phase evidence above. They are not presented as
  under-200 successes.
- Token/context rules, stop switch, attended serialization, verification, and
  sequential `run_steps` remain covered by existing suites.

## 2026-10-26 latency fastpath

The 200 ms interactive contract covers tool shapes, not the decision-model
call. The model round trip through the gateway is now the dominant share of a
decision step (~85%): measured text calls take 287-313 ms, small-vision calls
(14.5 KB JPEG) take 328-345 ms, and cold calls take 2.5-4.0 s.

- **Keep-alive pinger** (`scripts/llm-pool-systemone.mjs`):
  `LLM_POOL_KEEPALIVE_MS` defaults to 30000; 0 disables it. After 65 s idle,
  the first decision measured 0.332 s, down from 2.5-4.0 s cold.
- **Decision-skip cache** (`packages/agent/src/decision-cache.ts`): identical
  frame decisions replay the gateway answer with a 2 s TTL, invalidated on
  hash change. Live measurement: first call 2576 ms (cold, populating), then
  0 ms with `decision.cache` `"hit"`.
- **Speculative prefetch**: the next decision is requested while the current
  action dispatches. If the frame changes mid-flight, the prefetch is
  discarded (observed `"discarded"`); the next decision makes a fresh
  ~300-540 ms call and never applies the stale answer.
- **Decision image budget**: `state.image` is capped at 20 KB decoded
  (`packages/agent`, `image-too-large`). The decision image is captured at
  480x300 q50, with a 320x200 q30 retry; a 230,820-byte raw hot frame
  transmits as 9,100 bytes.
- **Deferred settle**: `DEFERRED_SETTLE_QUIET_MS` changes from 30 to 15; the
  deferred fence drops from 60 ms to ~30 ms for an early-event settle in the
  controlled-clock measurement. The silent deadline remains 100 ms.

Known limits: hot frames are larger than the cap by design. The decision
path sends its own sized capture while vision keeps full frames.
