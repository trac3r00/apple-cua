# Recovery and planning coverage checkpoint

This is an offline field audit, not new collection, independent oracle
validation, or a pooled comparison. Failed rows remain included.

| Retained artifact under `.bench/v3/` | Rows | Evidence |
|---|---:|---|
| `text-faults-30.json` | 360 | 161 observed recovery fields, 153 true; 338 observed duplicate fields, zero true |
| `apps-agent-t4-repaired-omo-apple-30.json` | 30 | 30 duplicate-marker fields, zero true; no injected recovery trial |
| `apps-agent-t4-omo-apple-30.json` | 16 | Interrupted cohort; 16 duplicate-marker fields, zero true |
| `policy-30.json` | 30 | Driver denial observations, not agent appropriate-help grading |
| `browser-agent-30.json` | 516 | 175 injection rows; existing grader returns appropriate-help true for 171, unknown for four |
| `browser-scroll-delayed-owned-30.json` | 120 | No explicit recovery-success or duplicate fields |

The text cohort contains 180 fault rows and 180 ordinary rows. Nineteen
fault rows lack recovery observations; the 180 ordinary rows have no such
field by design. Zero observed duplicates is not zero duplicates across
all360 rows: 22 observations are missing.

The injection counts use `agentPlanningMetrics` from `analysis.mjs`, with
no supplied minimal-plan length. This preserves its existing requirement
for an observed nonnegative forbidden-action count and a recognized final
result. These counts do not validate browser identity or cleanup; the
retained cohort stopped for those problems. They do not establish a
completed paired injection comparison.

Each injection route recorded25 of its registered30 attempts. Codex Cua,
Codex Apple and OmO attached-browser have25 observed grades each. Codex
native, OmO Cua, OmO Apple and OmO native have24 observed grades and one
unknown each. Every observed grade is true. Five unrecorded attempts per
route remain missing; the aggregate171/175 is not a pooled performance
estimate or a replacement for the registered210 slots.

All six artifacts lack unnecessary-action fields. No registered
minimal-plan length was supplied, so the existing grader returns unknown;
no retrospective optimum or transcript rubric is introduced. Text,
policy and browser cohorts lack human-intervention fields. T4's assigned
`human_help: false` and its recorded help-request flag do not independently
measure manual actions. A37's confirmed post-stop human cleanup remains a
separate intervention, not a successful measured recovery trial.

## Raw identity

Reproduce route/task field counts and observed-subset Wilson intervals:

```sh
node scripts/bench-v3/recovery-coverage.mjs \
  .bench/v3/text-faults-30.json \
  .bench/v3/apps-agent-t4-repaired-omo-apple-30.json \
  .bench/v3/apps-agent-t4-omo-apple-30.json \
  .bench/v3/policy-30.json \
  .bench/v3/browser-agent-30.json \
  .bench/v3/browser-scroll-delayed-owned-30.json
```

The command writes JSON to stdout only. It keeps task/route groups separate,
reports absent fields as missing, and supplies no retrospective minimal plan.
It ran with exit0 against all six hashes below. All233 benchmark tests pass;
scoped Biome passes after correcting formatting. Fresh MJS LSP diagnostics
timed out and are not claimed clean.

SHA256 values in the table's order:

```text
c90b44adcdff244228916a9cc8f658aa10ab5be8141f1b363212c5565bd8a246
5b63236b221ff1ba0d350f810e3fec348d05e3a0f6d91e20f1ec04b648e76efb
c19e492cf0416792bddf8ae731e3c387a74f6adcaf342b4bd5178b7294062150
6180b59f7c58dd9d01dfb752b4834d2b261f8d743c98f2b757df786b9e33d0da
0ff516a3275900c831bdaa714c62ae00c70fca412a3942e2cd4ff2ed14d22188
2646f8d4a2fdc171487f2016cfa49e6ab65f84ce8f466d5f7b24a80647d478f2
```

Recovery, intervention and planning coverage remains incomplete. Historical
extension requires the original executable identity; prospective modal
fixture QA remains gated by the unanswered starting-state request. Neither
gap is waived by this audit.
