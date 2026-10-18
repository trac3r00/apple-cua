# Matched Safari scrolling and delayed-field driver checkpoint

## Final registered endpoint

A28 completes ninety pairs per task, all 360 attempt closures verified,
zero recorded disturbance. Independent final Safari AX inventory is empty
and its model hidden with zero tabs. Scrolling is 90/90 on both routes:
S1/R1/R1p/R2 PASS, p95 ratio 0.166072, CI [0.150038, 0.169407].
Delayed-field is Apple 88/90, Cua 90/90: R1 PASS; S1/R1p/R2
INCONCLUSIVE. Its p95 ratio is 0.134956, CI [0.132883, 0.871969];
completion Wilson CI [0.922555, 0.993885]. Neither task has sufficient
report/safety evidence for F1/F1p/D1. No extension beyond ninety is prescribed.

Delayed failures at iterations 60 and 90 report the same one-character-short
prefix, without tool errors. The page's unsequenced asynchronous reports can
also overwrite a complete value with an older prefix: a deterministic reversed
arrival test reproduces this separate oracle defect. Historical rows lack event
sequence evidence, so actual input loss versus report ordering remains unresolved.
Both failures stay scored. Prospective ordering repair is a separate harness,
not a retrospective score correction.

Final stage raw SHA-256:
`2be41a17b55f9b780c2423b661bf2a59e9ee2efd7342a620307d54f9a497a5c2`.
Analysis `browser-scroll-delayed-extension-90-analysis.json` SHA-256:
`5190d7cea159365de438f15fd1c78ea2de0f177b4dba11c330771d59b9bf8d35`.
Claims: `browser-scroll-delayed-extension-90-claims.json`.
The pending statements below are retained historical checkpoints.

A28 blocks 31-60 are verified with all 120 stage closures and zero
disturbance. Cumulative scrolling counts are 60/60 for both routes;
delayed-field counts are Apple 59/60, Cua 60/60. The Apple failure remains
included: iteration 60 returned no tool error but independent page state
contained `Bench-v2 marker 8c5`, missing the final `2`. The retained
false_success field is a non-error-plan/oracle-disagreement proxy, not an
actual task-success report. This input truncation requires diagnosis after
the fixed endpoint; no native build or action plan changes during collection.
Stage raw SHA-256:
`99396a3825fdf7581a34a16d65fc53da1aaa61728bff6d03eb4d4af784031a55`.
Independent final Safari inventory has empty AX IDs and a hidden zero-tab
model. Registered final blocks 61-90 follow without changing the plan/oracle.

A27 completed thirty paired blocks per task: both routes 30/30 on each
task. All 120 attempt closures are verified, with zero recorded disturbance.
Independent final Safari inventory finds no AX windows and only a hidden
zero-tab model. These are scripted drivers, not agent or attached-browser
results. Delayed readiness is setup outside task latency, not timed recovery.

| Task | Apple/Cua p95 ratio | Paired bootstrap CI | Claims |
|---|---:|---|---|
| safari-scroll-link | 0.162231 | [0.146800, 0.162988] | S1/R1/R2 PASS |
| safari-delayed-field | 0.133508 | [0.127761, 0.135830] | S1/R1/R2 PASS |

Both R1p claims remain INCONCLUSIVE, Wilson interval [0.886487, 1].
The registered extension qualifies: projected half-width at ninety pairs
0.032768 around observed completion 1; hypothetical 90/90 lower bound
0.959064. F1/F1p/D1 remain INCONCLUSIVE for missing report/safety evidence.
Stages 31-60 and 61-90 are pending, with both task streams preserved together.

Raw `browser-scroll-delayed-owned-30.json` SHA-256:
`2646f8d4a2fdc171487f2016cfa49e6ab65f84ce8f466d5f7b24a80647d478f2`.
Analysis `browser-scroll-delayed-owned-30-analysis.json` SHA-256:
`48adbeff8e58b29a9889172afb07ff4c885c50630815e676e6c3f8ab1a338752`.
Claims: `browser-scroll-delayed-owned-30-claims.json`.
Verify with `node scripts/bench-v3/verify-browser-cohort.mjs .bench/v3/browser-scroll-delayed-owned-30.json`.
