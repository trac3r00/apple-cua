# Clipboard cross-app driver checkpoint

## Final registered endpoint

A24 is complete: Apple 90/90, Cua 0/90; all 180 attempt cleanups
verified, zero recorded disturbance. Independent final inventory finds
TextEdit documents zero, TextEdit/Safari AX IDs empty, and only a hidden
zero-tab Safari model. S1/R1/R1p/R2 PASS; F1/F1p/D1 remain INCONCLUSIVE.
Apple/Cua p95 ratio 0.0959674, paired CI [0.0911698, 0.0977073].
Completion Wilson lower bound is 0.959064. The Cua failures stay included.

Final stage raw SHA-256:
`720d6e86daf968af7936a6a95d13ee73e44565b36f0b5be46079ea748fa5c021`.
Analysis `browser-cross-app-extension-90-analysis.json` SHA-256:
`dc095791c97b02792e0a42697d5357bf77e29a44248db85e759bb1215608b758`.
Claims: `browser-cross-app-extension-90-claims.json`.
Checkpoint pending statements below are historical and superseded.

A24 blocks 31-60 are verified: stage Apple 30/30, Cua 0/30,
cumulative Apple 60/60, Cua 0/60. All 120 attempt cleanups are verified
with zero recorded disturbance. Independent TextEdit inventory reports
zero documents and no AX windows; Safari has no AX windows and only a
hidden zero-tab model. Stage raw SHA-256:
`76b8d10038e2bdddbc29d31535cbf107ebf2ee6011ca3391492f996e6fcdfc96`.
Blocks 61-90 remain required by the registered fixed extension.

A23 completes thirty seed-20261009 paired blocks: Apple 30/30, Cua 0/30.
All sixty attempts verify exact owned TextEdit document absence, AX absence,
off-screen surface, both window closures and owned file removal. Traces
record zero pointer/focus disturbance. Final independent TextEdit inventory
finds zero documents and no AX windows.

Task-scoped S1 PASS: p95 ratio 0.09528, paired CI [0.08951, 0.09872].
R1 observed completion and R2 noninferiority PASS. R1p INCONCLUSIVE,
Wilson CI [0.88649, 1]; fixed extension to 60 then 90 is required by the same
projection used for heading/form/link. That extension is pending.
F1/F1p actual-report and D1 safety remain INCONCLUSIVE for missing evidence.
Cua's retained non-error-plan/oracle disagreement is not a fabricated task
success report. Its independent field outcome retains the clipboard sentinel.

Raw `.bench/v3/browser-cross-app-owned-30.json` SHA-256:
`7192a83f925ecc1aa11ea7cc7415cadcbb59851f104dda83b1f4b612e2a9b541`.
Analysis `browser-cross-app-owned-30-analysis.json` SHA-256:
`97c44d79079cee955b8f8821fd13567c3258260076cddc57649129ebfbd31f1f`.
Separate claims: `browser-cross-app-owned-30-claims.json`.
Verify with
`node scripts/bench-v3/verify-browser-cohort.mjs .bench/v3/browser-cross-app-owned-30.json`.
Prior exploratory cleanup failures and independent recoveries stay separate.
