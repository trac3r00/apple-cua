# Resource and disturbance coverage checkpoint

This audit counts retained fields, including failures. It does not validate
the underlying oracle, impute unrecorded attempts, pool subjects, or replace
the registered paired analyses. Raw identities are recorded in
RECOVERY-PLANNING-COVERAGE.md.

| Artifact under `.bench/v3/` | Recorded rows | Latency/calls | Tokens | Cost | Focus/pointer |
|---|---:|---:|---:|---:|---:|
| `text-faults-30.json` | 360 | 360/360 | 360/360 | 0/360 | 360/360 |
| `apps-agent-t4-repaired-omo-apple-30.json` | 30 | 30/30 | 30/30 | 30/30 | 30/30 |
| `apps-agent-t4-omo-apple-30.json` | 16 | 16/16 | 16/16 | 16/16 | 16/16 |
| `policy-30.json` | 30 | 30/30 | 0/30 | 0/30 | 30/30 |
| `browser-agent-30.json` | 516 | 513/516 | 512/516 | 292/516 | 513/516 |
| `browser-scroll-delayed-owned-30.json` | 120 | 120/120 | 120/120 | 0/120 | 120/120 |

Latency/calls and focus/pointer have matching observed counts within each
row of this table, but are separate measurements. A present Boolean is
counted even when false; a numeric zero is observed, while null, absent or
nonfinite values remain missing.

Both T4 artifacts record driver calls and cached tokens for every retained
row. Browser agents record driver calls for295/516 rows and no top-level
cached-token field. Absence of that field does not establish zero cached
usage: client transcripts and nested usage may carry additional evidence.
Scripted rows use `calls` for transport calls; absence of `driver_calls`
is not missing the scripted call measurement.

Driver tokens are payload-size proxies, not actual LLM usage. Driver cost
remains unknown, not zero. Agent cost is client-reported usage cost, not a
claim about subscription billing. Calculator's independently disclosed
double-counted image proxy has a separate retained-raw sensitivity analysis;
see CALCULATOR-RESULT.md. It is not mixed into these cohorts.

A33's16 recorded rows leave14 registered slots unrecorded. Browser agents
record516 of630 registered slots, not a completed thirty-block endpoint.
A37 records64 of90 registered T4 slots, with63 verified passes and failed64;
26 later slots remain unrecorded. Its resource totals include the failure
and are recorded-only totals, not a completed-population estimate.

Continuous disturbance traces and final snapshots are different evidence.
Present false flags alone do not prove complete trace coverage or safe
cleanup. T4's transient mutation on64 remains an unintended change even
after restoration. See T4-METRIC-COVERAGE.md and the retained stop audit.

Resource-field measurement is complete for the retained audit inputs.
Incomplete paired collection, historical extension, physical ownership and
unobserved fields remain open under their separate obligations.
