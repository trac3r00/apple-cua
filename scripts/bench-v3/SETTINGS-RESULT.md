# Settings version driver checkpoint

## Final registered endpoint

A26 is complete: both routes 90/90, all 180 owned window closures and
distinct process terminations verified, zero recorded disturbance.
Independent final pgrep confirms System Settings absent. S1/R1/R1p/R2
PASS; F1/F1p/D1 remain INCONCLUSIVE for missing report/safety evidence.
Final Apple/Cua p95 ratio 0.407636, paired CI [0.399908, 0.415341].
Completion Wilson lower bound is 0.959064.

Final stage raw SHA-256:
`f7baa010b7597c3191f488cfc0e3d3621853ef03ffab7748186065da68b55dbd`.
Analysis `settings-version-extension-90-analysis.json` SHA-256:
`327300b1bfe6e6769089d932c2e47dcdcddfb7f5cb938bbb1459d91d068be92a`.
Claims: `settings-version-extension-90-claims.json`.
Pending statements in the retained checkpoints below are superseded.

A26 blocks 31-60 verified both routes 30/30 in the stage, cumulatively
60/60 each. All 120 attempt window closures and distinct owned process
terminations are verified, zero recorded disturbance. Final pgrep finds
System Settings absent. Stage raw SHA-256:
`4a025a583aef55470ba006e56f21c4b3794eca037ff9c0d6d8cdd1cdd38b1121`.
Cumulative analysis/claims: `settings-version-extension-60-analysis.json`
and `settings-version-extension-60-claims.json`. The fixed final stage
61-90 follows; this checkpoint is not the registered endpoint.

A25 completed thirty randomized pairs: both routes 30/30, sixty verified
owned-window closures and distinct process terminations, zero recorded
pointer/focus disturbance. Independent sw_vers supplies the expected version;
the window text oracle checks it. Final pgrep finds System Settings absent.

S1 speed PASS: Apple/Cua p95 ratio 0.412857, paired bootstrap CI
[0.403579, 0.427990]. R1 observed completion and R2 noninferiority PASS.
R1p remains INCONCLUSIVE with Wilson interval [0.886487, 1].
Actual-report F1/F1p and safety D1 remain INCONCLUSIVE for missing evidence.
These are scripted driver claims, not agent results.

The fixed extension qualifies: projected half-width at ninety pairs is
0.03277 around observed rate 1; hypothetical 90/90 has Wilson lower bound
0.959064. The additional paired stages are registered in A26 and remain pending.

Raw `.bench/v3/settings-version-owned-30.json` SHA-256:
`c763843fd84a65faa0ef2f77b481afa6c7e30da5fa5b85e132b57897f2f1c8fe`.
Analysis `settings-version-owned-30-analysis.json` SHA-256:
`320a1bb35b9c3ca391864ce941ea9d88869b8c00b3b95dd5f2ec46b1bee4162f`.
Claims: `settings-version-owned-30-claims.json`.
Verify with `node scripts/bench-v3/verify-settings-cohort.mjs .bench/v3/settings-version-owned-30.json`.
Exploratory pilots and their failures remain separate and unchanged.
