# Historical delayed-field prefix diagnosis

Read-only forensic review, 2026-10-11. No GUI input, archived-code execution,
rebuild, permission change, raw rewrite or scoring change was performed.
The protocol and DELAYED-REPAIRED-RESULT.md were consulted first.

## Conclusion

The retained evidence proves two disagreements between the Apple typing
response and the independent page oracle, not that the driver dropped the
last character. Both typing responses expose an AXTextField change from
empty to the complete `Bench-v2 marker 8c52`; both final page states contain
`Bench-v2 marker 8c5`. The historical page-report stream is not retained in
these rows. Input loss and stale asynchronous oracle state cannot be
distinguished conclusively. Both failures remain scored in A28.

`LEDGER.md:252-257` calls iteration 60 an "independently verified input
truncation". Read that as a verified short *reported page value*, not a
verified native-input mechanism. The narrower wording in
`SCROLL-DELAYED-RESULT.md:14-20` and `PREREGISTRATION.md:512-519` correctly
preserves the uncertainty.

## Original retained rows and call evidence

Paths below are relative to `.bench/v3/` unless otherwise specified.
Large raw artifacts were inspected in bounded line ranges, not loaded or
executed wholesale.

| Cohort / row | Retained identity | Outcome |
|---|---|---|
| A27 initial | `browser-scroll-delayed-owned-30.json`, iterations 1-30 | Published checkpoint: delayed Apple 30/30, Cua 30/30 |
| A28 stage 31-60, delayed Apple 60 | `browser-scroll-delayed-extension-31-60.json:2422400-2422609`; Safari window 17168, PID 5190; attempt `3e8fa156-974f-436a-9f8d-813fd368465c`; nonce `1c61b7d5-a05a-4f8f-a25d-87f66cf2f3ac` | `pass:false`, `fixture_failed:false`, `false_success:true`; 4 calls; 11.033367625 seconds |
| A28 stage 61-90, delayed Apple 90 | `browser-scroll-delayed-extension-61-90.json:2088090-2088334`; Safari window 18149, PID 5190; attempt `393e630f-69f2-491e-96e7-85fc7f6e489e`; nonce `749f9cb7-de51-4066-9c22-346590476427` | Same flags; 4 calls; 10.811174375 seconds |

Each failed row retains the same complete prescribed sequence:

1. `list_windows`, locating the owned Safari fixture.
2. `get_app_state`, bound to the exact window, AX enabled, screenshot disabled.
3. `run_script`: `apple.app("Safari",{window:...}).click({"text":"Code"})`.
4. `run_script`: `apple.app("Safari",{window:...}).type("Bench-v2 marker 8c52")`.

Both script responses have `ok:true`. In the typing response,
`axChanges.changed` identifies element 12, role AXTextField, label Code:
`before.value` is empty and `after.value` is the full marker. The retained
response strings have abbreviated tails; they are not full event transcripts.
The complete type argument and the AX value above are visible before that
abbreviation. Thus a harness argument already missing `2` is contradicted by
both rows, and persistent AX-level truncation at return is contradicted by
their recorded observations. AX is not independent proof of DOM input.

Final page states match each assigned baseline nonce, have `ready:true`,
`forbidden:0`, an empty hash and the one-character-short field value. Neither
has a `sequence` field. Cleanup closes the exact owned window, with no
leftovers or error. Disturbance traces contain no activation, pointer event
or cursor change and zero movement in both APIs; frontmost remains Terminal.
These are disturbance summaries, not per-character keyboard or DOM traces.

The immediately preceding delayed Cua row at iteration 60
(`...31-60.json:2422400-2422470`) and iteration 90
(`...61-90.json:2088090-2088190`) reports the full marker and its own nonce.
The latter retains `type_text` with the full argument, background pixel
delivery and `delivered_count:20`, explicitly labelled unverified. Different
owned documents and adapters make these controls evidence of nearby fixture
success, not a proof about the failed Apple document.

`browser-scroll-delayed-extension-90-analysis.json:1-100` preserves provenance
for all three stages and reports Apple delayed 88/90, with two proxy
false-success observations. `SCROLL-DELAYED-RESULT.md:5-20` reports Cua 90/90
and scrolling 90/90 on both routes. No denominator or failure is discarded.
The row's `false_success` means successful tool calls plus failing oracle,
not an actual driver or agent task-success assertion.

## Mechanism and prospective comparison

`scripts/bench-v3/browser-driver.mjs:5-31,65-79` binds the Apple sequence to
the owned window and passes the marker directly to `.type`.
`scripts/bench-v3/browser-run.mjs:83-110,207-228,405-461` defines the plan,
nonce/exact-field predicate, non-error proxy and the readiness/timing boundary:
the field is ready before measurement; the oracle waits after the steps,
with a 10-second bound. The failed rows' tool-only durations are
1.031924333 and 0.809938250 seconds respectively, versus roughly 11 and
10.8 seconds end-to-end. This is consistent with spending the remaining time
in the oracle wait, not proof of a slow or interrupted native type operation.

The registered A29 finding is a separate oracle defect: an older asynchronous
input report can replace newer state. Its causal chain is page input event
snapshot -> independent asynchronous POST -> arrival-order state replacement
-> exact-field predicate observing an older prefix. If the full report arrives
before the oracle subscription and is then overwritten, the later predicate
can miss it. No retained historical arrival timestamps prove this happened.

Current `scripts/bench-v3/pages.mjs:18-23,61-80` attaches increasing safe
integer sequence numbers and rejects older/equal reports within the same
document nonce. `scripts/bench-v3/pages.test.mjs:52-79` explicitly sends a
complete sequence-2 report followed by a prefix sequence-1 report and asserts
that the full value is retained. This test was read, not run in this review.
A29 documents its original regression and prior passing checks; those are
historical records, not fresh execution evidence here.

A31/A32 are separate delayed-only cohorts:
`browser-delayed-monotonic-30.json`,
`browser-delayed-monotonic-extension-31-60.json`, and
`browser-delayed-monotonic-extension-61-90.json`.
`scripts/bench-v3/DELAYED-REPAIRED-RESULT.md:3-42` records both routes 90/90,
all 180 closures and zero recorded disturbance. Its A31 checkpoint records
30/30 each. The repaired final raw tail at
`browser-delayed-monotonic-extension-61-90.json:835667-835703` independently
shows a full page field with `sequence:21` and the source identities.

Original and repaired final tails retain identical hashes for browser-run,
browser-driver, drivers and `packages/core/dist/platform/macos.js`
(native hash `a8c4114c5c64f967a2a3fa95ea8b48f7e32790f8fd4df4050ebb5acecf28465c`).
The page hash changes from
`b59026c142bf16110b150286b24aea3d80648a9a0040fef78d73fab88c08b4ef`
to `ccb34fe12f62ef56a1c0264c3665d203788f0d0e48b34050b49f7b5217d12cd9`.
Disturbance helper hashes also change, and the schedule becomes delayed-only.
These are recorded identities, not independently recomputed hashes.
The new completion record supports that harness revision; it does not prove
historical causal attribution or isolate the page change experimentally.

## Competing hypotheses and remaining verification gap

- **Truncated task argument:** rejected for these rows; both retained calls
  request the complete marker.
- **Wrong document or field absent:** contradicted by exact owned-window
  targeting, matching page nonce, Code AX field and `ready:true`. This does
  not prove every intermediate focus transition.
- **Last character persistently absent in AX when type returned:** contradicted
  by both recorded complete AX values. A transient DOM/input discrepancy or
  a subsequent edit remains possible.
- **Older report overwrote newer complete page state:** a documented and
  regression-covered oracle mechanism consistent with the observations;
  unproven for iterations 60 and 90.
- **Disturbance interrupted typing:** no positive evidence in either retained
  continuous disturbance summary. Those summaries do not trace keyboard
  delivery and cannot exclude every input-path failure.
- **Field inserted during measured typing:** not supported; registered
  delayed readiness is preparation outside latency, not timed recovery.

The missing evidence is an ordered, timestamped, same-document history of DOM
input/change values and report send/arrival/acceptance events, plus an
independent final DOM read at failure before cleanup. Per-character native
delivery/focus evidence would be needed to attribute a genuine DOM deficit to
the driver rather than the renderer. The retained AX value is useful but
cannot replace that independent DOM record.

Two additional discovery waves checked benchmark documentation, `.bench/v3`
artifact names, its `history` inventory and verifier references; neither
identified a separate delayed-field event/HTTP archive. Content searching
large raws was limited to a 4 MiB prefix, so absence across all repository or
session logs is not asserted. The original failed-row tails themselves retain
only final page state, tool responses and disturbance summaries. No archived
page code was executed or historical sequence reconstructed.

A future explicitly authorized experiment could record both DOM event order
and HTTP arrival order before typing, retain an independent DOM failure
read-back, and compare original and sequenced oracle behavior on that same
trace. It would discriminate mechanisms prospectively; without recovered
historical events it still could not establish what happened in these two
old attempts. Historical scoring and the causality gap remain unchanged.
