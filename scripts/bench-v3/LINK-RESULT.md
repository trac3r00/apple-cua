# Safari link driver checkpoint

## Final registered endpoint

A22's fixed extension is complete: both routes 90/90, all 180 closures
verified, zero recorded disturbance. Independent final inventory finds no
Safari AX windows and only a hidden zero-tab model. S1/R1/R1p/R2 PASS;
F1/F1p/D1 remain INCONCLUSIVE for missing report/safety evidence.
Final speed ratio 0.201467, paired CI [0.179840, 0.210284]; completion
Wilson lower bound 0.959064. No further completion extension is prescribed.

Final stage raw SHA-256:
`f2de20cd62f98fb128038aa8c94db9b31071c52909a3b5ed1ec9010567deab28`.
Analysis `browser-link-extension-90-analysis.json` SHA-256:
`bf27f71a0af2dd7e79356899364dc36eb31f7f768033df26e1d4c7f803d64f71`.
Separate claims: `browser-link-extension-90-claims.json`.
The checkpoints below are historical; their pending statements are superseded.

A22 stage 31-60 is verified: both routes now 60/60 cumulatively,
all 120 attempt closures verified, zero recorded disturbance. Independent
inventory finds no Safari AX windows and only a hidden zero-tab model.
Stage raw SHA-256:
`d47dbe966a5db6e79ffd3d8a74a2066d743f6746048e063535634f9dfd50fd20`.
Cumulative analysis: `browser-link-extension-60-analysis.json`; claims:
`browser-link-extension-60-claims.json`. Speed ratio is 0.210141,
CI [0.187082, 0.216356]. This checkpoint does not replace the registered
ninety-pair endpoint; blocks 61-90 follow. Later-stage cleanup includes A23's
compositor-event subscription outside latency; task/native/oracle stay fixed.

A21 completed thirty randomized pairs: both routes 30/30, sixty verified
owned-page closures, zero measured pointer/focus disturbance. The independent
oracle verifies the assigned document nonce and #destination hash. Final
inventory finds no AX windows and only a retired hidden zero-tab model.

Task-scoped speed S1 PASS: Apple/Cua p95 ratio 0.20668, paired CI
[0.18736, 0.22809]. R1 observed completion and R2 noninferiority PASS.
R1p remains INCONCLUSIVE, Wilson CI [0.88649, 1]. Actual-report F1/F1p and
safety D1 remain INCONCLUSIVE for missing evidence, not failures erased from
the data. The registered action path does not test Cua's CDP page route.

The fixed R1p extension rule requires both routes to 60 and then 90: projected
half-width at n=90 is 0.03277 around observed rate 1; ninety hypothetical
successes have Wilson lower bound 0.95906. Extension is pending, so this is a
checkpoint rather than the final population verdict.

Raw `.bench/v3/browser-link-owned-30.json` SHA-256:
`3da4652d032ea677732ae7d643f4681bd1d2b0b2db0f07fa1d548b890aa487e0`.
Analysis `browser-link-owned-30-analysis.json` SHA-256:
`ff90efc06a9ee20c852ed421d0737c1d9205569fc59610d086b296fb91db838a`.
Separate claims: `browser-link-owned-30-claims.json`.
Verify with
`node scripts/bench-v3/verify-browser-cohort.mjs .bench/v3/browser-link-owned-30.json`.
Exploratory pilots are not included in scored denominators.
