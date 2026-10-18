# Finished-work acceptance: Freeform to Keynote

## Deliverables

Create a new task-owned Freeform board, "Intent to outcome", and a matching
three-slide Keynote presentation. Preserve earlier documents and all user work.
Use native editable text and shapes, not a flattened image passed off as a
finished native workflow.

Content:

1. Freeform: one left-to-right flow, Understand / Plan / Act / Verify, with short
   supporting copy and a return path from Verify to Plan for observed failures.
2. Keynote slide 1: "Work without interruption" and a concise statement of purpose.
3. Keynote slide 2: the same four-stage process with consistent labels and layout.
4. Keynote slide 3: "Done means useful" with artifact, interaction and evidence
   acceptance criteria, not implementation metrics.

## Visual acceptance

- A clear title and reading order; consistent type hierarchy and a restrained
  accent palette.
- Aligned objects, equal peer sizes, deliberate spacing, legible copy at fit view.
- No overlaps, clipped text, default placeholders, random test objects or
  unexplained decoration. Every slide and the full board inspected.
- Freeform and Keynote convey the same story; three slides are not a dump of the
  work log.

## Interaction acceptance

- Background-only input; no window relocation, raise or human cleanup. Target-window
  activation without raising it is permitted by the background pointer contract.
- Observe each new context; use semantic controls and verified workflow blocks.
  Inspect unknown controls before input. Do not infer an unlabeled button's role
  from AX index order.
- No replay of a non-idempotent action merely because AX reports no change.
- Record actual action counts, observations, recovery transitions and elapsed
  execution time. Do not invent a latency target or exclude failures from totals.
- Record physical pointer and frontmost PID around representative workflow
  blocks. State the scope of the measurement, including active human input.
- Stop on a real safety refusal; fix its cause rather than bypassing the guard.

## Engineering acceptance

Fix only control defects demonstrated by this workflow; regression tests must
model those failures. Pure workflow guidance does not get prose-pinning tests.
Global shared-worktree failures remain distinct from owned changes.

Passing event dispatch, a title check, fixture QA and a green unit suite are
supporting evidence, not substitutes for these finished artifacts.

## Current artifact evidence

- Freeform board `Intent to outcome`: native editable cards, text, arrows and
  pen return path. Named-window verification passed. Capture:
  `.omo/evidence/fluent-workflow/freeform-diagram.png`.
- Keynote: local run artifact `/Users/cminseo/Documents/Work without interruption.key`
  (outside the checkout, not distributed with this report), 541806 bytes
  when first saved. Three native slides, not screenshots pasted into slides.
  Named-window verification and file existence both passed.
- Every slide was inspected after editing; captures are
  `.omo/evidence/fluent-workflow/keynote-slide-{1,2,3}.png`.
- Independent visual reviews passed the board and all three slides for hierarchy,
  legibility, alignment, clipping/overlap, meaningful content and lack of test debris.
  Those reviews explicitly do not establish interaction fluency or editability.

## Workflow accounting and current verdict

The private continuous QA transport had captured 63 request receipts at the first
accounting checkpoint, totaling 137.17 seconds inside native calls. This excludes
model deliberation, transport setup failures and later verification calls; it is
not end-to-end elapsed time. Of those receipts, 56 had identical before/after
frontmost PID and physical pointer. The user was active during the run; the other
seven do not establish either theft or preservation.

The 45 retained script results contained 107 action records, including 52
observations and 37 batch invocations. A batch is not one physical action, so
these are not raw click/event counts. Six retained results failed; an earlier
syntax-only failure and overwritten early selection failure also occurred.
No failure is excluded from the verdict because it was later recovered.
Dispatched physical-input totals were not retained separately. The mixed receipts
cannot reconstruct them, so the action-count acceptance criterion remains unmet.

Useful repeated blocks improved substantially: three matching Keynote cards were
created, styled, labeled and positioned in one 6.09-second script; each peer
batch took 1.76-1.88 seconds. The verified Freeform rename took 1.39 seconds.
These are scenario measurements, not universal performance promises.

**Artifact verdict: PASS. First-pass seamless-workflow verdict: FAIL.**
The useful outputs do not erase avoidable recovery work: automatic list/period
substitution, expired popovers, a stale recently-used-shape target, unnecessary
Select All, a transport lifetime timeout, a Keynote bundle identity change and
misidentified save-sheet context all interrupted the run.

The run produced three concrete corrections:

- Action evidence excludes unrelated applications' newly visible windows.
- Default observation resolves an AXSheet to its AXWindow ancestor when available,
  exposing the controls and correctly scaled parent image. Explicit requested
  window IDs remain strict; explicitly targeting a sheet can still encounter the
  demonstrated native capture mismatch.
- A file panel's keyboard shortcuts go to the panel instead of an unrelated app
  menu equivalent. Keynote's Go to Folder had been mistaken for Find Previous.

Historical verification on 2026-10-09: all workspace typechecks passed; that Vitest run passed 1401
cases but found 23 failures from one stale preflight mock. After adding the new
observation helper to that mock without changing assertions, all 25 cases in
that file passed. This gives passing results for 1424 distinct cases, with two
opt-in cases skipped. All 21 script tests and the complete build passed.
`git diff --check` passed. Lint still reports only the previously existing
formatting differences in `packages/mcp/src/guarded-session.ts`; those unrelated
sections were not reformatted. LSP timed out on some files; CLI typechecks passed.

## Rebuilt-runtime native verification

The saved deck was opened for native PDF export as a useful finishing workflow.
The rebuilt default observation correctly selected document window 34880,
returned its 1920 x 1132 image, and exposed the save sheet's filename and Export
button. This reproduces and verifies the sheet-context fix in the real app.

The person then changed desktop context: Keynote disappeared from the visible
window inventory, its document bounds changed, and both screenshot methods and
the scoped AX walk stopped exposing content. The Go to Folder chord was sent
through background input without the old Find Previous refusal, but its visual
outcome cannot yet be verified. The before/after frontmost PID remained Terminal
and the pointer was unchanged around that chord. Do not treat this bounded
measurement as proof against a transient focus change.

No window was moved or foregrounded by the agent. The visibility subscription
fired and fresh observation resumed. That read exposed a caller mistake: a
`press_keys` array had sent separate keys instead of one chord and changed the
pending export filename to `g.pdf`. The filename was restored through AX and the
correct chord was sent. No file with that mistaken name was exported.

The corrected chord was not refused as Find Previous, but its intended Go to
Folder outcome was not confirmed. Later Export attempts were refused before
dispatch because the current scoped observation exposed no controls. Read-only
native probes alternated between unavailable exact-window roots and successful
scoped reads; one unscoped read exposed the controls while a separate exact-window
read did not. This remains an unresolved observation limitation, not proof that
every failure was caused by a Space change. Screen Recording and Accessibility
permissions are granted, and ScreenCaptureKit already requests off-screen windows.

## User-requested checkpoint

The user selected **Preserve checkpoint** after reviewing the final-check options.
Further native inputs are stopped. PDF export was not completed, and no PDF exists
at the requested Documents path. The native Keynote file still exists; the
completed Freeform board and reviewed slide captures are preserved.

The final native workflow check is deferred by that explicit decision, not marked
passed. Artifact acceptance remains PASS; seamless background operation remains
unproven. The earlier six-improvement ulw-loop remains incomplete with its
original criteria intact. No repository commit or publication was made.

The workflow reference now prescribes planned content/layout, native workflow
blocks, stable-target fast chains, verified dynamic picker boundaries, partial
receipt recovery, meaningful pixel checks and final artifact verification.
No broad human-like or seamless claim is justified by this first run.
