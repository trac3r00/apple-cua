# Fixed sample-size extension audit

Audit checkpoint: 2026-10-11. This report audits section 6 of PREREGISTRATION.md,
claims in section 7, and amendments A1-A26. It changes no measurement artifact.
The six strong two-window/heading/form/link/cross-app/Settings extensions are complete.
Parent verification after this audit confirms Settings 90/90 for both routes,
all 180 window/process cleanups, zero disturbance and final process absence.
Historical original-task
extension obligations remain outstanding. Historical "blocked" labels below
mean not reproduced in this audit, not that safe isolated reproduction is
impossible; that feasibility investigation is still pending. There is no complete current-native
21-task suite and no justified full-suite macro verdict.

## Calculation and evidence contract

n means paired iterations per route, not the total number of rows. All failures
and oracle disagreements remain in primary calculations. Corrected analyses use
10,000 iteration-cohort bootstrap resamples, seed 20261009. Recorded intervals
below are read from those analyses, not a fresh bootstrap or a rerun of the GUI.
Original/raw headers and representative first rows were read to reconcile scope,
iteration, refusal and oracle metadata; large historical raw files were not read
end to end or independently rehashed. The provenance table records analysis-bound
SHA-256 identities, not newly verified file hashes.

For the registered half-width projection, h90 = (U30-L30)/2 * sqrt(30/90).
The projected interval is centered on the observed estimate, as the scoped
RESULT documents do for completion. This is a planning approximation, not a
new CI or a promise that the endpoint resolves. For Wilson completion, also
calculate the hypothetical interval at the same rate and n=90. Use z=1.96
(the retained analyses' Wilson convention). S1 PASS requires U<=0.75, FAIL
requires L>0.75. R1p PASS requires L>=0.95, FAIL requires U<0.95.
R2/R3 PASS requires L>-0.05, FAIL requires U<0; PASS is tested first.
Only INCONCLUSIVE claims trigger this rule; observed R1/F1 predicates do not.
Every triggered comparison must run both routes to 60 and then 90, even if
60 looks decisive. No stopping at 60 or extension beyond 90 is prescribed.

Completion calculation key:

| Key | Apple initial Wilson CI | Projected h90 and interval around observed rate | Hypothetical n=90 Wilson | Trigger |
|---|---|---|---|---|
| W (30/30) | [0.886487, 1] | 0.032768; [0.967232, 1] after bounding | [0.959064, 1] | R1p requires extension |
| Z (0/30) | [0, 0.113513] | 0.032768; [0, 0.032768] | [0, 0.040936] | R1p already FAIL |
| C (4/30) | [0.053097, 0.296813] | 0.070355; [0.062978, 0.203688] | Not needed to select extension | R1p already FAIL |
| A (14/30) | [0.302324, 0.638577] | 0.097068; [0.369599, 0.563735] | Not needed to select extension | R1p already FAIL |
| P (28/30) | [0.786765, 0.981523] | 0.056222; [0.877112, 0.989555] | 84/90: [0.862099, 0.969090] | R1p cannot resolve at projected n=90 |

For zero false-success events, Wilson upper bounds are 0.113513 at 30,
0.060172 at 60 and 0.040936 at 90, never below 0.01. Even the optimistic
half-width projection gives 0.032768>0.01. Thus F1p does not trigger extension
for zero-event cohorts. Actual driver task-success reports are unavailable;
SCORING-NOTES.md distinguishes the retained non-error-plan/oracle-disagreement
proxy from report-based F1/F1p. Neither more rows nor proxy zeroes repair that.
Missing disturbance, duplicate or unintended-change metrics are never zero.

## All 21 original tasks

H-text, H-menu and H-fault are historical native cohorts; H-Finder includes A8
oracle/binding fixes before A9 native correction. Their n=30 is retained, not
extended by current-native results. The original subject was e62e06f. A9 changed
menu readiness and background Finder navigation. These historical native
revisions are no longer reproduced by the current native build: required
extensions must be labelled blocked on exact historical revision reproduction,
not silently run with the amended driver. No restoration was attempted here.
A historical task being blocked does not erase its statistical obligation.

Current amended native subject is the A9/A15 identity
`a8c4114c5c64f967a2a3fa95ea8b48f7e32790f8fd4df4050ebb5acecf28465c`
(as registered in A15). A separate strong oracle is not a continuation of the
weak original two-window oracle. A23 adds stronger prospective cleanup outside
latency to form/link stages; retain that disclosure within their registered
stages. Current original n below means initial completed scored n for that
specific cohort, not exploratory pilots or historical failed setup slots.

| Original task | Initial n and Apple:Cua successes | Current verified n / cohort | Inconclusive claim and calculation key | Extension disposition |
|---|---|---|---|---|
| textedit-fill-save | 30; 30:0 | 30, H-text | R1p W; F1/F1p/D1 evidence limits | Required, historical revision blocked |
| textedit-multiline | 30; 30:0 | 30, H-text | R1p W; F1/F1p/D1 | Required, historical revision blocked |
| textedit-two-windows | 30; 30:0 weak; separate strong 30; 30:0 | Weak remains 30; strong A15 90; 90:0 | Weak R1p W; strong R1p resolved; F1/F1p/D1 remain | Strong extension completed; historical weak obligation not pooled or discharged |
| textedit-select-replace | 30; 30:26 | 30, H-fault | R1p W; F1/F1p | Required, historical revision blocked |
| textedit-undo | 30; 30:26 | 30, H-fault | R1p W; F1/F1p/D1 incomplete paired metrics | Required, historical revision blocked |
| clipboard-copy | 30; 30:26 | 30, H-fault | R1p W; F1/F1p | Required, historical revision blocked |
| stale-token-recovery | 30; 30:26 | 30, H-fault | R1p W; R3 already PASS; F1/F1p | Required, historical revision blocked |
| finder-create-folder | 30; 4:0 | 30, H-Finder | C: R1p FAIL; F1/F1p/D1 unavailable | No complete-observation inconclusive claim resolves by 90; no extension selected |
| finder-navigate | 30; 30:0 | 30, H-Finder; later refusal pilot separate | R1p W; D1 FAIL (30 focus flags) | Required, historical revision blocked; safety failure retained |
| finder-rename-file | 30; 30:0 | 30, H-Finder | R1p W; S1 projection below still inconclusive | Required by R1p, historical revision blocked |
| finder-select-file | 30; 30:30 | 30, H-Finder | R1p W; F1/F1p/D1 | Required, historical revision blocked |
| safari-form | 30; 30:30 | A20/A22 90; 90:90 | W triggered; endpoint R1p PASS; F1/F1p/D1 remain | Completed |
| safari-link | 30; 30:30 | A21/A22 90; 90:90 | W triggered; endpoint R1p PASS; F1/F1p/D1 remain | Completed |
| safari-heading | 30; 30:0 | A17/A19 90; 90:0 | W triggered; endpoint R1p PASS; F1/F1p/D1 remain | Completed |
| textedit-save-sheet | 30; 30:0 | 30, H-menu | R1p W; F1/F1p/D1 | Required, historical revision blocked |
| textedit-alert-dismiss | 30; 14:16 | 30, H-menu | S1 resolves by projection below; R2 does not; R1p A FAIL | Required by S1, historical revision blocked |
| textedit-rich-bold | 30; 30:29 | 30, H-menu | R1p W; F1/F1p/D1 | Required, historical revision blocked |
| clipboard-cross-app | 30; 30:0 | A23/A24 90; 90:0 | W triggered; endpoint R1p PASS; F1/F1p/D1 remain | Completed |
| calculator-add | corrected initial 30; 0:0 | A18 fresh-process 30; earlier stopped/shared-process cohorts separate | Z: R1p FAIL; F1/F1p/D1 unavailable | No qualifying extension; faster failure S1 PASS |
| settings-version | 30; 30:30 | A25/A26 verified 90; 90:90 | W triggered; endpoint R1p PASS; F1/F1p/D1 remain | Completed |
| two-apps-one-task | 0 scored | 0; ownership QA pending | No n=30 CI | Missing coverage, not an assessed extension |

### Historical actual paired intervals

Ratios include all elapsed failures. Differences are Apple minus Cua.
R2 passes all listed tasks except alert-dismiss; R3 also passes the listed
fault recovery comparisons. Completion R1p uses the keys above.

| Task/cohort | Apple:Cua completion | p95 ratio estimate [95% CI] | Paired completion difference [95% CI] |
|---|---|---|---|
| textedit-fill-save | 30/30 : 0/30 | 0.171161 [0.169319, 0.177685] | 1.000000 [1.000000, 1.000000] |
| textedit-multiline | 30/30 : 0/30 | 0.168851 [0.165593, 0.174055] | 1.000000 [1.000000, 1.000000] |
| textedit-two-windows | 30/30 : 0/30 | 5.661822 [5.143469, 6.061008] | 1.000000 [1.000000, 1.000000] |
| textedit-alert-dismiss | 14/30 : 16/30 | 0.295732 [0.271641, 0.939187] | -0.066667 [-0.400000, 0.266667] |
| textedit-rich-bold | 30/30 : 29/30 | 0.228784 [0.221937, 0.245227] | 0.033333 [0.000000, 0.100000] |
| textedit-save-sheet | 30/30 : 0/30 | 3.614634 [2.329530, 4.713195] | 1.000000 [1.000000, 1.000000] |
| clipboard-copy | 30/30 : 26/30 | 0.175797 [0.161463, 0.218080] | 0.133333 [0.033333, 0.266667] |
| server-killed | 30/30 : 27/30 | 0.205409 [0.201430, 0.297513] | 0.100000 [0.000000, 0.233333] |
| stale-token-recovery | 30/30 : 26/30 | 0.180055 [0.178550, 0.253267] | 0.133333 [0.033333, 0.266667] |
| textedit-select-replace | 30/30 : 26/30 | 0.086621 [0.074769, 0.206259] | 0.133333 [0.033333, 0.266667] |
| textedit-undo | 30/30 : 26/30 | 0.384526 [0.250072, 0.395511] | 0.133333 [0.033333, 0.266667] |
| textedit-window-reopened | 28/30 : 12/30 | 0.540514 [0.155170, 0.825183] | 0.533333 [0.366667, 0.700000] |
| finder-create-folder | 4/30 : 0/30 | 16.643051 [16.000898, 19.764868] | 0.133333 [0.033333, 0.266667] |
| finder-navigate | 30/30 : 0/30 | 4.810397 [4.519654, 5.038285] | 1.000000 [1.000000, 1.000000] |
| finder-rename-file | 30/30 : 0/30 | 0.796510 [0.668564, 0.835453] | 1.000000 [1.000000, 1.000000] |
| finder-select-file | 30/30 : 30/30 | 0.480080 [0.446815, 0.496433] | 0.000000 [0.000000, 0.000000] |
| textedit-window-reopened (alias-corrected) | 30/30 : 24/30 | 0.285463 [0.264543, 0.308608] | 0.200000 [0.066667, 0.366667] |

Additional resolving projections, using the actual intervals above:

- Alert-dismiss S1: h90=0.192704; projected ratio interval
  [0.103028, 0.488436] resolves PASS. R2 h90=0.192450 gives
  [-0.259117, 0.125783], still inconclusive. This task must extend even though
  its observed and population completion already fail.
- Finder rename S1: h90=0.048177; projected interval [0.748333, 0.844686]
  still straddles 0.75. R1p independently selects extension.
- Historical reopened-window S1: h90=0.193416; projected interval
  [0.347098, 0.733930] resolves PASS. P completion cannot resolve R1p;
  S1 nevertheless selects extension. Alias-corrected data cannot be appended
  to this historical cohort to satisfy that obligation.

The three-task historical menu macro S1 is also inconclusive:
estimate 0.625359, CI [0.599468, 0.804712], h90=0.059250,
projected interval approximately [0.566109, 0.684608], resolving PASS.
All three menu tasks already require extension independently. This cohort
macro is not a full-suite macro and cannot select a favorable task subset.

## Completed endpoints

| Cohort | Verified paired n | Completion Apple:Cua | Current S1 ratio [CI] | R1p |
|---|---:|---|---|---|
| textedit-two-windows | 90 | 90:0 | 6.432851 [5.505563, 6.811194] | [0.959064, 1.000000] |
| safari-heading | 90 | 90:0 | 1.125594 [0.760964, 1.261114] | [0.959064, 1.000000] |
| safari-form | 90 | 90:90 | 0.160739 [0.153208, 0.166291] | [0.959064, 1.000000] |
| safari-link | 90 | 90:90 | 0.201467 [0.179840, 0.210284] | [0.959064, 1.000000] |
| clipboard-cross-app | 90 | 90:0 | 0.095967 [0.091170, 0.097707] | [0.959064, 1.000000] |
| settings-version | 90 | 90:90 | 0.407636 [0.399908, 0.415341] | [0.959064, 1.000000] |
| calculator-add | 30 | 0:0 | 0.137026 [0.127616, 0.140066] | [0.000000, 0.113513] |

## Completed fault and conformance tasks

| Fault / cohort | Initial and current n | Claims / actual evidence | Extension obligation |
|---|---|---|---|
| Stale observation | 30 -> 30, H-fault | 30:26; R3 CI [0.033333, 0.266667] PASS; R1p W | Required; historical revision blocked (same original task, not counted twice) |
| Server killed after input | 30 -> 30, H-fault | 30:27; R3 CI [0, 0.233333] PASS; R1p W; S1 PASS | Required by R1p; historical revision blocked |
| Closed/reopened window, historical | 30 -> 30, pre-alias repair | 28:12; R3 CI [0.366667, 0.700000] PASS; R1p P; S1 projection resolves | Required by S1; exact historical harness/native boundary must be reproduced, not pooled |
| Closed/reopened window, alias-corrected | 30 -> 30, separate harness cohort | 30:24; R3 CI [0.066667, 0.366667] PASS; S1 PASS; R1p W | Required by R1p; historical native identity must be reproduced |
| Interrupted reopened workflow | Same reopen rows | Resume/recovery is the reopen task, not a second independent sample | Same obligation; no double count |
| Partial stdio frames | 30 -> 30 per route, transport-only | protocol-30.json has 60 rows; fragmented/coalesced success flags; no GUI completion or task-speed interpretation | Conformance complete; no registered population conformance threshold, so no automatic R1p extension |
| Coalesced requests | Same 30 transport blocks | Separate predicate in the same rows | Same conformance disposition |
| Read-only cancellation | Same 30 transport blocks per route | Responsiveness observed; input_after_cancel null | Does not resolve mutation interruption; more of these rows cannot do so |
| Transport process death | Same 30 transport blocks per route | death flag is not the after-input GUI recovery oracle | No additional registered population conformance claim; GUI server-killed obligation separate |
| Mutation cancellation, canonical A11 | 30 -> 30 per route | All 60 pending requests cancelled, responsive and cleaned; full input before cancellation in 30/30 each; responsiveness Wilson [0.886487, 1] | Interruption INCONCLUSIVE, not resolvable by width projection; no extension selected on that structural evidence gap |
| Scoped policy-denied | 30 -> 30 Apple; Cua unavailable | 30 Apple passes, unchanged sentinel/no landed input; Cua scoped runtime not configured | Apple conformance complete; paired R3 unavailable. If treated as task population-completion R1p, W requires Apple 60/90 and a defined runnable comparison; cannot claim paired completion or silently substitute daemon |
| Delayed rendering | 30 attached attempts, 0 matched Safari pairs | attached browser-delayed 30/30, renderer/isolation provenance limits from A7 | Missing matched driver coverage; attached task-only Wilson W conditionally selects extension, not a matched Apple/Cua obligation satisfied by those rows |

The attached archive also has browser-scroll and browser-form 30/30 each.
It is explicitly not a matched Safari comparison. A7's provenance correction
means physical renderer and exact isolated cleanup must be established before
promoting matched conclusions; collecting 60 more identically ambiguous rows
cannot repair this. No new scoped endpoint was inferred from the incomplete
agent archive or native agent pilots. Those remain missing/partial L4 coverage,
not initial completed n=30 populations eligible for automatic extension.

## Missing safety and retained failures

Historical text/menu/Finder lack paired unintended-change/duplicate metrics.
Finder navigation has paired focus difference [1,1], so D1 FAIL even though
completion is 30/30. Finder creation retains 26 Apple proxy disagreements.
Historical fault analyses have complete recorded mutation/duplicate pairs for
clipboard-copy, select-replace, stale-token and server-killed, but only 27/30
for undo and 12/30 for pre-fix reopen. Alias-corrected reopen has only 24/30.
These recorded saved-control predicates are not proof that unsaved live control
was unchanged: inspected representative raw rows have control_document null.
The strong two-window cohort remedies Apple's live-control check, but Cua
refuses before its control observation. No report here treats missing paired
metrics as a D1 PASS. At most the fully observed recorded predicates support
their own scoped comparisons; increasing n cannot retrospectively fill gaps.

Current scoped RESULT documents explicitly retain F1/F1p/D1 INCONCLUSIVE.
The five completed 90-pair extensions do not repair those missing predicates.
The two pre-alias Apple reopen observer-deadline failures remain failures.
Calculator's stopped three rows and shared-process source-aware cohort remain
separate from the corrected fresh-process all-failure cohort. Earlier weak
heading, zero-call ownership and cleanup-failure pilots are excluded only as
labelled exploratory cohorts, never discarded from the evidence record.

## Inspected artifact identities

All following analyses were read in full through read, including per-task
observations, paired intervals and raw provenance. Scoped documents read:
STRONG-TWO-WINDOW-RESULT.md, HEADING-RESULT.md, FORM-RESULT.md, LINK-RESULT.md,
CROSS-APP-RESULT.md, SETTINGS-RESULT.md, CALCULATOR-RESULT.md,
RECOVERY-RESULTS.md and AGENT-PILOT-RESULTS.md. PREREGISTRATION.md was read
through A26; COVERAGE.md and EVIDENCE-AUDIT.md were consulted (their older
pending statements are historical and do not supersede the scoped endpoints).
SCORING-NOTES.md was read in full. This report does not independently validate
all cleanup rows or producer exit codes; scoped reports retain that evidence.

| Inspected analysis | Analysis-bound raw artifact SHA-256 identities |
|---|---|
| text-native-corrected-analysis.json | text-native-30.json: 38a6b82a60a71c3e95e9bc9c5f1ac442c9c81980e0f09cd708a491395dc67b0e |
| menus-corrected-analysis.json | menus-30.json: 11fe19bc5a2f3f614daf78c2e6b2384f0077a3d484cdcf103004c94f41313bc5 |
| text-faults-corrected-analysis.json | text-faults-30.json: c90b44adcdff244228916a9cc8f658aa10ab5be8141f1b363212c5565bd8a246 |
| finder-corrected-analysis.json | finder-30.json: f50618f9807ecc9a5a9e536c044c6b216b0759f9e49d18b23a4f501b6f85b728 |
| reopen-postfix-corrected-analysis.json | reopen-postfix-30.json: 38daff273d94b06bfc385022b0f5e1ec06c7a54de6f07b4ec4dde41fc17c2e3a |
| text-two-window-strong-corrected-analysis.json | text-two-window-strong-30.json: 65c0432b75d2181c415d59216bb6ac1d6ef93678ac73d52eeffc364fa5d876d1 |
| text-two-window-extension-90-analysis.json | text-two-window-strong-30.json: 65c0432b75d2181c415d59216bb6ac1d6ef93678ac73d52eeffc364fa5d876d1; text-two-window-extension-31-60.json: 3508799d83acacff4c27c0b707df589c38cfe020dee2f453f6b4cd9b0a8bd191; text-two-window-extension-61-90.json: 137d4d38ae216c4bb11e31f4a01d347493b3c0c8c005b4e361932adff3f7a4cf |
| safari-heading-nonce-30-analysis.json | safari-heading-nonce-30.json: 6325c95a0df8e40350d624eea5f4b5fd4bed7f84da75b9befa9bee7830a88c63 |
| safari-heading-extension-90-analysis.json | safari-heading-nonce-30.json: 6325c95a0df8e40350d624eea5f4b5fd4bed7f84da75b9befa9bee7830a88c63; safari-heading-extension-31-60.json: 1eef454cd388ef882cb09f41f40d53d05400462f2448fd8d429778a0b6004b4a; safari-heading-extension-61-90.json: 4dca7a3304f7147f7399d2c83770cb3fb355794afde7404bc9856c8e0c46717a |
| browser-form-owned-30-analysis.json | browser-form-owned-30.json: 0de3efa438470a2589370fe084d45927e11a52f864078b80ccd3f9c4fbdafd07 |
| browser-form-extension-90-analysis.json | browser-form-owned-30.json: 0de3efa438470a2589370fe084d45927e11a52f864078b80ccd3f9c4fbdafd07; browser-form-extension-31-60.json: fbbb89c65a2c75091655f490347820711377b387c91d7c7b69182806c61c8600; browser-form-extension-61-90.json: 05e0479045f3764b5c6225959f99aceaf7500a750fac68baed9131214da56a1f |
| browser-link-owned-30-analysis.json | browser-link-owned-30.json: 3da4652d032ea677732ae7d643f4681bd1d2b0b2db0f07fa1d548b890aa487e0 |
| browser-link-extension-90-analysis.json | browser-link-owned-30.json: 3da4652d032ea677732ae7d643f4681bd1d2b0b2db0f07fa1d548b890aa487e0; browser-link-extension-31-60.json: d47dbe966a5db6e79ffd3d8a74a2066d743f6746048e063535634f9dfd50fd20; browser-link-extension-61-90.json: f2de20cd62f98fb128038aa8c94db9b31071c52909a3b5ed1ec9010567deab28 |
| browser-cross-app-owned-30-analysis.json | browser-cross-app-owned-30.json: 7192a83f925ecc1aa11ea7cc7415cadcbb59851f104dda83b1f4b612e2a9b541 |
| browser-cross-app-extension-90-analysis.json | browser-cross-app-owned-30.json: 7192a83f925ecc1aa11ea7cc7415cadcbb59851f104dda83b1f4b612e2a9b541; browser-cross-app-extension-31-60.json: 76b8d10038e2bdddbc29d31535cbf107ebf2ee6011ca3391492f996e6fcdfc96; browser-cross-app-extension-61-90.json: 720d6e86daf968af7936a6a95d13ee73e44565b36f0b5be46079ea748fa5c021 |
| settings-version-owned-30-analysis.json | settings-version-owned-30.json: c763843fd84a65faa0ef2f77b481afa6c7e30da5fa5b85e132b57897f2f1c8fe |
| settings-version-extension-60-analysis.json | settings-version-owned-30.json: c763843fd84a65faa0ef2f77b481afa6c7e30da5fa5b85e132b57897f2f1c8fe; settings-version-extension-31-60.json: 4a025a583aef55470ba006e56f21c4b3794eca037ff9c0d6d8cdd1cdd38b1121 |
| calculator-fresh-process-30-analysis.json | calculator-fresh-process-30.json: be99c567f110c94aa71f17e5f8db686a8b4d13578eb2d25b3a8323bce88299b4 |
| cancellation-mutation-canonical-30-analysis.json | cancellation-mutation-canonical-30.json: ce920a4953c05350aa399cf6ef3a9c7a8dec8b630199b5d4826a60f986ca2211 |

protocol-30.json, policy-30.json and attached-30.json were read in full and
parsed to confirm 60 transport, 30 policy and 90 attached rows, respectively.
Their content hashes were not calculated in this audit. Other raw files read
in bounded excerpts: text-native-30.json, menus-30.json, text-faults-30.json,
finder-30.json, reopen-postfix-30.json, text-two-window-strong-30.json and
settings-version-extension-31-60.json. This is the precise raw inspection scope.

## Remaining obligations for the parent

1. Verify A26 final 61-90 endpoint after its active producer completes; do not
   call the verified 60 checkpoint a completed fixed extension.
2. Resolve historical revision reproducibility before attempting the required
   text/menu/Finder extensions. Current-native fresh n=30 cohorts are separate
   experiments and must not silently discharge historical obligations.
3. Retain separate required extensions for server-killed and both reopen
   cohorts: pre-fix reopen qualifies by S1, corrected reopen by R1p.
4. Complete two-apps-one-task initial coverage and matched Safari scrolling/
   delayed-field fault coverage. Policy baseline availability and cancellation
   interruption remain structural gaps, not zero-event population PASS claims.
5. Preserve missing report/safety metrics and original failures. No full-suite
   or agent completion verdict follows from five task-scoped 90-pair endpoints.

No GUI, clipboard, desktop lock, agent client, build, measured runner/source,
raw artifact, security setting, message or commit was changed by this audit.

