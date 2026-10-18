# Strong two-window driver result (current revision)

## Completed registered extension

A15's registered extension has completed all 90 paired blocks. Apple
completion is 90/90; Cua is 0/90. All 180 owned-document cleanups are verified,
with zero recorded focus/pointer disturbance. Each additional cohort passed
full-row validation, and the final independent exact-path inventory counted
zero owned documents. No losing attempts were excluded.

The final task-scoped verdicts are S1 FAIL, R1 PASS, R1p PASS, R2 PASS,
and F1/F1p/D1 INCONCLUSIVE. Apple completion Wilson 95% CI is
[0.95906, 1], now supporting the registered population threshold of 0.95.
The final paired p95 ratio is 6.433, CI [5.506, 6.811]. It includes fast Cua
background refusals, not successful Cua editing. Missing Cua control mutation
evidence and unavailable actual driver success reports still limit safety
and false-report claims.

Final analysis: `.bench/v3/text-two-window-extension-90-analysis.json`.
Machine-consumed claims: `.bench/v3/text-two-window-extension-90-claims.json`.
Additional raw provenance:

- `text-two-window-extension-31-60.json` SHA-256
  `3508799d83acacff4c27c0b707df589c38cfe020dee2f453f6b4cd9b0a8bd191`
- `text-two-window-extension-61-90.json` SHA-256
  `137d4d38ae216c4bb11e31f4a01d347493b3c0c8c005b4e361932adff3f7a4cf`

```sh
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/text-two-window-extension-90-analysis.json \
  .bench/v3/text-two-window-strong-30.json \
  .bench/v3/text-two-window-extension-31-60.json \
  .bench/v3/text-two-window-extension-61-90.json
```

This completes this task's fixed extension only. Other tasks and the full
agent matrix remain incomplete. The initial n=30 result below is retained
as the historical checkpoint, not the final extended estimate.

## Initial thirty-block checkpoint

This is one task, not a verdict on the driver suite or on agent reasoning.
The background-only cohort contains 30 randomized paired blocks with an
independent saved/live source and control oracle and 60 verified cleanups.
The native subject revision is the amended current revision, not the original
PR merge subject. Raw results are retained unchanged.

Raw artifact: `.bench/v3/text-two-window-strong-30.json`.
SHA-256: `65c0432b75d2181c415d59216bb6ac1d6ef93678ac73d52eeffc364fa5d876d1`.
Corrected analysis: `.bench/v3/text-two-window-strong-corrected-analysis.json`.
Analysis uses seed 20261009 and 10,000 iteration-cohort resamples.

| Registered claim | Task result | Evidence |
|---|---|---|
| S1 driver speed | FAIL | Apple/Cua p95 ratio 3.358; paired 95% CI [2.657, 3.589], entirely above 0.75 |
| R1 observed completion | PASS | Apple 30/30; Cua 0/30; independent completion, not tool-return success |
| R1p population completion | INCONCLUSIVE | Apple Wilson 95% CI [0.88649, 1], not a lower bound of 0.95 |
| R2 completion regression | PASS | Paired completion difference +1.00; 95% CI [1.00, 1.00] |
| F1 actual driver false-success reports | INCONCLUSIVE | Actual task-success reporting unavailable; non-error-plan/oracle disagreement proxy is 0/30 |
| F1p population false success | INCONCLUSIVE | Zero events still has Wilson upper bound 0.11351, above 0.01 |
| D1 safety | INCONCLUSIVE | Both traces show zero focus/pointer disturbance, but Cua control mutation evidence is missing after refusal; duplicates are not a fully observed paired metric |

Apple p95 is 1.05732 s; Cua p95 is 0.31485 s. Failures remain in latency,
as preregistered: Cua's early refusal is faster than Apple's completed task.
This does not show faster successful Cua editing or superior task performance.
The one-task macro is not the full-suite macro.

As `SCORING-NOTES.md` requires, the registered driver proxy is not an actual
task-success report. Its zero observed count remains unchanged and satisfies
the raw proxy predicate, but does not support report-based F1/F1p claims.
Agent terminal DONE reports are a separate, independently scoreable signal.

Apple's saved and live control remained unchanged. Missing Cua control
observations are not zero unintended changes. Driver payload-token estimates
are not agent billing tokens; costs remain unknown. No agent speed, model,
planning or intelligence claim is supported by this cohort.

Reproduce the offline analysis from the repository root:

```sh
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/text-two-window-strong-corrected-analysis.json \
  .bench/v3/text-two-window-strong-30.json
```

Extension assessment: R1p is inconclusive at n=30. The projected half-width
at n=90 is 0.03277 (current half-width multiplied by sqrt(30/90)); around
the observed rate 1 it would resolve the 0.95 boundary. As a separate check,
90 hypothetical successes have Wilson lower bound 0.95906. The registered
rule therefore requires this task to extend to 60, then 90, for both routes
when safe execution is available. These projections are not new observations
or a population PASS. F1p cannot resolve at n=90 even with zero events:
its hypothetical Wilson upper bound is 0.04094, still above 0.01.
Missing paired safety observations cannot be repaired by sample projection.

This report does not authorize unsafe Cua input collection. Subsequent
Calculator and agent pilots recorded disturbance, and current GUI collection
is stopped with TextEdit cleanup unresolved. The full benchmark is incomplete.
