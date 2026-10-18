# Task-scoped recovery results

These are separate paired driver cohorts, not agent results or a full-suite
verdict. Each task has 30 randomized paired blocks. All losing attempts remain
included. Corrected analyses use seed 20261009 and 10,000 iteration-cohort
bootstrap resamples, with raw SHA-256 provenance.

| Fault and cohort | Apple completion | Cua completion | Apple minus Cua, paired 95% CI | Registered R3 |
|---|---|---|---|---|
| Server killed after input, historical fault cohort | 30/30 | 27/30 | +0.100 [0.000, 0.233] | PASS |
| Window reopened, before fixture-alias correction | 28/30 | 12/30 | +0.533 [0.367, 0.700] | PASS |
| Window reopened, after fixture-alias correction | 30/30 | 24/30 | +0.200 [0.067, 0.367] | PASS |

R3 passes here because each lower bound exceeds the registered -0.05 margin.
That is a task-specific non-inferiority result, not proof of superiority for
every fault. In particular, server-death McNemar p=0.25 does not establish a
conventional significant completion advantage.

The original reopen cohort's two apple observer-deadline failures remain
failures. The corrected cohort is separate, not a rewrite or pooled extension
of that cohort. It fixes fixture identity, not an established native driver
defect. No result here establishes cancellation interruption: the separate
canonical cancellation cohort observed all input complete before cancellation
and remains INCONCLUSIVE for interruption.

| Cohort | Raw artifact | Corrected analysis |
|---|---|---|
| Historical fault tasks | `.bench/v3/text-faults-30.json` | `.bench/v3/text-faults-corrected-analysis.json` |
| Corrected reopened-window task | `.bench/v3/reopen-postfix-30.json` | `.bench/v3/reopen-postfix-corrected-analysis.json` |

These files' provenance hashes bind the calculations to the exact raw data.
Reproduce each independently from the repository root:

```sh
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/text-faults-corrected-analysis.json .bench/v3/text-faults-30.json
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/reopen-postfix-corrected-analysis.json .bench/v3/reopen-postfix-30.json
```

Recorded owned-document cleanups cover all 360 historical fault attempts
and all 60 corrected reopen attempts. That cleanup evidence does not replace
live control mutation evidence, pointer-source attribution, or recovery
coverage for unavailable baselines. Other fault claims and the unfinished
agent/task matrix still require their own evidence.
