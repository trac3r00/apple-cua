# Safari form driver checkpoint

## Final ninety-pair extension

A22's fixed extension is complete: both routes 90/90, all 180 owned closures
verified, zero measured pointer/focus disturbance. R1p now PASS with Wilson
lower bound 0.95906. S1 PASS, p95 ratio 0.16074, paired CI
[0.15321, 0.16629]. R1 and R2 PASS; F1/F1p and D1 remain INCONCLUSIVE.
Final inventory has no AX windows and only a retired hidden zero-tab model.
This completes the form extension, not the driver suite or agent matrix.

Extension raw hashes:
`fbbb89c65a2c75091655f490347820711377b387c91d7c7b69182806c61c8600`
(31-60) and
`05e0479045f3764b5c6225959f99aceaf7500a750fac68baed9131214da56a1f`
(61-90). Cumulative `.bench/v3/browser-form-extension-90-analysis.json`
SHA-256:
`1e7da092a4ab3df7da40e16239b6291e6d503f63415105058631cda92d0cd76a`.
Separate claims: `browser-form-extension-90-claims.json`.
Later stages use A23's stronger event-driven cleanup outside latency; original
task steps, native subject, field oracle and seeded pairing stream are fixed.

## Historical thirty-pair checkpoint

A20 completed thirty randomized paired blocks: both routes 30/30, sixty
verified closures, zero measured pointer/focus disturbance. The independent
oracle verifies the assigned document nonce and exact field marker. Final
read-back finds no Safari AX windows and only an empty hidden retired model.

Task-scoped S1 PASS: Apple/Cua p95 ratio 0.16854, paired CI
[0.15693, 0.17495]. R1 and R2 PASS; paired completion difference 0,
CI [0, 0]. R1p remains INCONCLUSIVE, Wilson CI [0.88649, 1].
F1/F1p actual-report and D1 safety claims remain INCONCLUSIVE; driver
non-error-plan disagreement and zero disturbance do not fill missing evidence.

The fixed R1p extension rule requires both routes to 60 then 90: projected
half-width at n=90 is 0.03277 around observed rate 1, and ninety hypothetical
successes have Wilson lower bound 0.95906. This is an extension assessment,
not additional observations. The extension is pending.

Raw `.bench/v3/browser-form-owned-30.json` SHA-256:
`0de3efa438470a2589370fe084d45927e11a52f864078b80ccd3f9c4fbdafd07`.
Analysis `browser-form-owned-30-analysis.json` SHA-256:
`376d2afa2626cfd5106584df7a715cf243c39a5667e914862db6e4956fc85125`.
Claims: `browser-form-owned-30-claims.json`.
Pilots and fixture failures remain separate. Payload token estimates are not
billed model usage; cost is unavailable. This registered Safari action path
does not compare Cua's CDP page tool or unrestricted foreground recovery.
