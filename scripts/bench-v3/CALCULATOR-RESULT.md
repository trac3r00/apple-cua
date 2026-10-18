# Calculator driver cohorts

## Corrected fresh-process cohort

A18 completed thirty randomized pairs with a fresh, AX-ready owned process
per attempt and timing from the first driver step through independent oracle
verification. Both routes completed 0/30. All 60 distinct PID terminations
are independently verified; traces record zero focus/pointer disturbance.
A final process inventory confirms Calculator absent. Earlier cohorts and
pilots below remain separate.

Task-scoped claims: R1 and R1p FAIL (Apple Wilson completion CI [0, 0.11351]);
R2 PASS (paired difference 0, CI [0, 0]). S1 PASS for all-attempt latency:
Apple/Cua p95 ratio 0.13703, paired CI [0.12762, 0.14007]. Both routes fail the
task, so this is faster failure, not faster successful arithmetic or copying.
F1/F1p actual-report claims and D1 safety remain INCONCLUSIVE because the
driver proxy and zero disturbance do not supply the missing evidence.
No inconclusive claim with complete observations qualifies for extension:
zero-event F1p cannot resolve at n=90 and missing safety data are not repaired
by a larger sample.

Raw `.bench/v3/calculator-fresh-process-30.json` SHA-256:
`be99c567f110c94aa71f17e5f8db686a8b4d13578eb2d25b3a8323bce88299b4`.
Analysis `calculator-fresh-process-30-analysis.json` SHA-256:
`ca4c2c10ff8ac63239205061db0507537229d759b08c0e0ee7fbc9edd3f66f97`.
Separate claims: `calculator-fresh-process-30-claims.json`.
Reproduce validation with
`node scripts/bench-v3/verify-fresh-calculator.mjs .bench/v3/calculator-fresh-process-30.json`.

### Payload estimate accounting correction

The calculator producer added image estimates twice: `estimated_tokens`
already includes the image component, but the recorded token field added
`image_tokens` again. Independent reconstruction from the sixty retained call
payloads matches that formula for every row. Thirty Cua rows each contain
501 excess estimated tokens, totalling15,030; Apple rows have no image
component and are unaffected. This is a response-size proxy, not actual LLM
usage or billed cost.

Original raw and analysis remain retained. Supplemental single-count
analysis uses seed20261009 and10,000 iteration-cohort resamples:
`.bench/v3/calculator-fresh-process-token-sensitivity-analysis.json`,
SHA256 `a66d7ca77d157eecd288e7231e58a3a3fb036855940e5dcdb784221476801c3a`.
Cua mean estimate changes from17,650.183333 to17,149.183333;
Apple stays1905.35. Only token summaries and paired token-difference intervals
change. Completion, latency, calls, disturbance and other per-task metrics
remain unchanged. The original failures are not rescored.

Reproduce with `node scripts/bench-v3/calculator-token-sensitivity.mjs`.
Per-row reconstruction is retained in
`.bench/v3/calculator-fresh-process-token-audit.json`.
The prospective producer now records the already-inclusive estimate at its
existing attempt boundary. Regression-first coverage fails before the change;
all230 benchmark tests and scoped style checks pass after it. Fresh MJS
language-server diagnostics time out, so they are not claimed clean.
No new Calculator GUI collection was performed for this correction.

## Historical shared-process source-aware cohort

Raw: `.bench/v3/calculator-source-aware-30.json`.
SHA-256: `2db6f4a468abbc6e4737e52671426eff581784c7480272a509d540c32249d421`.
Analysis: `.bench/v3/calculator-source-aware-30-analysis.json`.

Thirty randomized paired task attempts completed: apple 0/30, Cua 0/30.
All sixty rows retain measured zero focus/pointer disturbance. Newly owned
Calculator PID 93526 was independently verified gone after the run.
The full-file validator, not an artifact name or partial search, establishes
these counts. Both routes lose under the original clipboard oracle.

Interpretation limits:

- One newly owned Calculator process was shared across attempts, then quit.
  This is not sixty fresh-app fixtures or sixty per-attempt app closures.
- The clipboard was reset to a sentinel before every attempt, preventing
  an unchanged prior clipboard value from passing.
- The producer's elapsed field starts before sentinel/trace setup, not at
  the first driver call. Its interval is not promoted to registered S1
  first-call-to-last-call speed evidence.
- Non-error plan/oracle disagreement is the driver proxy, not actual
  task-success reporting. F1/F1p report-based claims remain INCONCLUSIVE.
- Prior three-row stopped collection and exploratory pilots remain separate,
  not overwritten, rescored or added to these denominators.

Observed completion fails the 95% criterion for this cohort; population
completion also fails (zero successes in thirty). However the fixture
lifecycle deviation prevents claiming fully conforming per-attempt isolation.
This report does not complete the driver suite or establish relative speed,
safe unrestricted input, or a driver intelligence advantage.

```sh
node scripts/bench-v3/verify-calculator-cohort.mjs \
  .bench/v3/calculator-source-aware-30.json
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/calculator-source-aware-30-analysis.json \
  .bench/v3/calculator-source-aware-30.json
```
