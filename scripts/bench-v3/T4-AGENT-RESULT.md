# T4 OmO+apple descriptive result

A36 completes30/30 independently verified clipboard-cross-app agent attempts
under background-only operation. Offline raw verification exits0, with full
task, source/control/page, usage, exact closure and safety evidence. All30
observed models match the registered model. No result is pooled with interrupted
A33, failed A34 or exploratory A35.

| Metric | A36 result |
|---|---|
| Completion | 30/30; Wilson95% CI [0.886487,1] |
| Actual RESULT-DONE false success | 0/30; Wilson95% CI [0,0.113513] |
| Failure-inclusive agent latency | Median93.411s; p95 148.015s |
| Agent tool calls | 389 total; mean12.967 |
| Driver transport calls | 181 total; mean6.033 |
| Recorded token field | 2,081,383 total; mean69,379.433 |
| Separately recorded cached tokens | 15,418,496 total |
| Reported cost | $37.336566 total; mean$1.244552 |
| Recorded focus/pointer disturbance | 0/30 each |
| Unintended changes/duplicate markers | 0/30 each |
| Missing model/calls/tokens/cost/safety | 0 |
| Unnecessary actions/appropriate help | Unknown; no registered T4 minimal plan or applicable help criterion |
| Independently measured manual intervention | Unavailable; assigned human_help flags are not that measurement |

For this task/cohort only, observed R1 and F1 predicates pass. R1p and F1p
are INCONCLUSIVE at these intervals. S2, R2 and D1 comparative claims are
INCONCLUSIVE because paired safety-eligible baselines are unavailable.
T4 has no injected fault or misleading-instruction challenge; do not use it
for R3 or D2. No suite-wide reliability, speed or intelligence winner follows.

The R1p half-width projection to90 can resolve the population criterion if
the completion rate persists; this is an outstanding extension obligation,
not completion of the registered paired design. No baseline is substituted
and no additional sample has been silently pooled.

Independent final probes exit0: TextEdit PID25961 has zero documents and AX
windows; Safari PID5190 has no AX windows, with model21381 hidden and zero tabs.
Both observed TextKit service AX inventories are empty. All three exact owned
files are absent. Cleanup proof is retained separately.

Artifacts:

- `.bench/v3/apps-agent-t4-repaired-omo-apple-30.json`
  SHA256 `5b63236b221ff1ba0d350f810e3fec348d05e3a0f6d91e20f1ec04b648e76efb`
- `.bench/v3/apps-agent-t4-repaired-30-analysis.json`
  Seed20261009,10,000 registered resamples; no paired comparisons exist.
- `.bench/v3/apps-agent-t4-a36-final-readback.json`

Reproduce the completed raw check with
`node scripts/bench-v3/verify-apps-agent-cohort.mjs .bench/v3/apps-agent-t4-repaired-omo-apple-30.json`.
Reproduce analysis with
`node scripts/bench-v3/save-analysis.mjs .bench/v3/apps-agent-t4-repaired-30-analysis.json .bench/v3/apps-agent-t4-repaired-omo-apple-30.json`.

Repository checks remain explained rather than green: typechecks and21 script
tests pass, while generated .omc state has28 lint formatting errors and three
unchanged live-display screenshot tests fail. The separate224 benchmark tests
and scoped style checks pass. No native rebuild occurred during collection.

## A37 fixed extension: stopped, not a completed ninety-attempt result

Stage31-60 completed30/30. Its offline verifier exited0 with full fixture and
safety evidence; all16 approved source hashes matched. Independent final
readback found no TextEdit AX windows or documents, no Safari AX windows,
Safari model22391 hidden with zero tabs, and all three owned files absent.
Raw SHA256: `d225996a36bd1cec95ef7acdcc2a6d6ae350efdc3e5a6f46e0c98269dac97c8b`.
Readback: `.bench/v3/apps-agent-t4-stage60-final-readback.json`.

The mandatory stage61-90 started only after that verification. It stopped at64
with task and cleanup errors `Error: spawnSync osascript ETIMEDOUT`, exit1.
The raw records three passes and one failure; iterations65-90 are missing,
not successes or removed denominator slots. The thirty-slot stage is not
verified complete or safe. Raw SHA256:
`15b43dc11ac965bf74a31a896848687ee2d264b979e06e70bac7548dcefb3fae`.
Raw: `.bench/v3/apps-agent-t4-extension-61-90.json`.
Stop evidence: `.bench/v3/apps-agent-t4-stage90-stop.json`.

Guarded recovery closed exact TextEdit windows22522 and22524; independent
native probes confirmed empty AX inventory and no matching document identities.
Safari window22527 remained in its native AX inventory. Guarded Safari access
was unavailable, and the cleanup handoff question timed out without an answer.
Do not infer closure or authorize further GUI collection from that timeout.
No retry, raw rewrite, new native build or ninety-attempt population verdict
follows. The A36 descriptive result above remains separately reported; A37
extension completion, population and comparative claims remain INCONCLUSIVE.

Attempt64's timeout is after agent execution, not evidence that the agent
never started: its retained agent result exits0 with RESULT DONE, thirteen
model-facing calls, ten driver calls and92.825s elapsed. The agent reports an
accidental source edit and restoration. The driver log independently records
a TextEdit set_value request restoring the marker, with a non-error response;
it retains call metadata, not complete response bodies. The subsequent host
observation shows the source marked Edited. These observations do not prove
the original accidental-edit mechanism, complete source restoration or task
success: independent oracle_inputs were not recorded before the timeout.
Attempt64's actual false-success outcome therefore remains unknown, not zero.
Its raw false_success flag is true; the offline verifier reports null because
the independent oracle inputs are missing. Retain both rather than silently
replacing the assigned raw classification with a verified outcome.
The verifier's generic "setup failed, not started or interrupted" diagnostic
must not be read as a reconstruction of this attempt's execution phase.

The retained agent stdout supplies stronger transient-change evidence than
the driver metadata alone. After driver call12 (select marker, CMD+C), its
tool-result readback shows TextEdit window22522's AXTextArea changing from
`Bench-v2 marker 8c52` to `c`. The restoration tool result for call14 then
shows `c` changing back to the original marker. This independently observed
source mutation must not be summarized as zero unintended changes for64,
even though the agent restored the displayed value. The underlying reason
the request inserted text can be explained by the key-sequence contract,
as checked below; the interrupted endpoint oracle still does not establish
complete task success.

An offline reproduction using the current shipped
`packages/core/dist/computer/key-sequence.js`, with a recording adapter
instead of native input, shows that `["CMD","C"]` dispatches two independent
keys without modifiers. `["CMD+C"]` dispatches one C key with the command
modifier. The measured call12 used the former sequence. This explains the
observed `c` insertion without assuming native modifier loss: the request
did not specify a copy chord. Source `pressKeys` maps each array entry
separately, and `pressKeySequence` parses each entry separately. This check
does not send GUI input, reproduce AppleEvent timeout causality, change the
tool contract or repair the failed cohort.

`.bench/v3/apps-agent-t4-extension-coverage-audit.json` records63 verified
slots out of90 registered slots,64 recorded slots and26 missing slots.
Recorded resource totals include64, not just successful attempts:837 agent
calls,385 driver calls,4,060,931 recorded tokens,33,557,632 separately cached
tokens, reported cost$76.533582 and summed agent elapsed6452.171s.
Unrecorded attempts have no measured resource values. This accounting audit
does not pool an incomplete extension into a population estimate or replace
the separately reported completed A36 cohort.

After the user confirmed Safari closure, an independent process inventory
found the former Safari PID5190 absent and TextEdit PID25961 still running
with no AX windows. Safari was not relaunched merely to query its model.
Both remaining owned disk files contained their original source/control
bytes; they were then removed and all three exact owned paths verified
absent. This resolves the post-stop fixture cleanup blocker, not the failed
task oracle or extension. The human handoff and readback are preserved in
`.bench/v3/apps-agent-t4-stage90-handoff-readback.json`; the raw hash remains
unchanged.
