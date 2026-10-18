# Safari heading driver result

## Final ninety-pair extension

A19's fixed extension completed: Apple 90/90, Cua 0/90, all 180 owned page
closures verified with zero measured disturbance. R1p now PASS with Wilson
lower bound 0.95906. R1 and R2 PASS; S1 FAIL with p95 ratio 1.12559 and paired
CI [0.76096, 1.26111]. F1/F1p and D1 remain INCONCLUSIVE for the missing
evidence described below. This completes the heading extension, not the suite.

Extension raw hashes are
`1eef454cd388ef882cb09f41f40d53d05400462f2448fd8d429778a0b6004b4a`
(31-60) and
`4dca7a3304f7147f7399d2c83770cb3fb355794afde7404bc9856c8e0c46717a`
(61-90). Cumulative analysis and claims:
`.bench/v3/safari-heading-extension-90-analysis.json` and
`.bench/v3/safari-heading-extension-90-claims.json`.
The analysis retains all three raw hashes and rejects duplicate pairing IDs.
Final independent inventory found no live Safari AX windows; it included the
subsequent browser pilot's retired zero-tab model, not a leftover heading page.

## Historical thirty-pair checkpoint

A17's corrected cohort completed 30 randomized paired blocks, seed 20261009.
Apple completed 30/30; Cua completed 0/30. All 60 owned page closures were
verified with zero measured pointer or focus disturbance. Final independent
inventory found no Safari model or AX windows; historical hidden WindowServer
surfaces remain untouched.

The oracle requires a document nonce different from setup and the prescribed
heading. Exploratory weak-oracle pilots are retained separately, not pooled.
Cua's Cmd+L succeeds; subsequent text input refuses same-PID keyboard ambiguity.
Its fast failure remains in the latency comparison.

| Task-scoped claim | Result | Evidence |
|---|---|---|
| S1 speed | FAIL | p95 ratio 1.20508, paired CI [0.77539, 1.42824] |
| R1 observed completion | PASS | 30/30 |
| R1p population completion | INCONCLUSIVE | Wilson CI [0.88649, 1] |
| R2 completion noninferiority | PASS | paired difference 1, CI [1, 1] |
| F1/F1p actual-report false success | INCONCLUSIVE | driver proxy is not an actual success report |
| D1 safety | INCONCLUSIVE | duplicate and unintended-mutation observations incomplete |

The registered extension rule applies to R1p: the n=30 half-width is 0.05676;
projected half-width at n=90 is 0.03277. Around the observed rate 1 this would
resolve the 0.95 boundary, as in the earlier two-window extension assessment.
Ninety hypothetical successes have Wilson lower bound 0.95906.
This arithmetic selects extension,
not a verdict. Collect both routes to 60 and then 90 with unique pairing IDs,
preserving the seeded schedule; the n=30 result is not the final R1p result.

Raw SHA-256:
`6325c95a0df8e40350d624eea5f4b5fd4bed7f84da75b9befa9bee7830a88c63`.
Analysis SHA-256:
`945fa586438d72f9f6ddf83c3d6409805974d1c32d031b09cc1c3433562f1280`.
Artifacts are `.bench/v3/safari-heading-nonce-30.json`,
`safari-heading-nonce-30-analysis.json`, and
`safari-heading-nonce-30-claims.json`.

Reproduce verification with
`node scripts/bench-v3/verify-heading-cohort.mjs .bench/v3/safari-heading-nonce-30.json`.
The full benchmark and other task cohorts remain incomplete.
