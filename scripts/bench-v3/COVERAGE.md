# Coverage audit

This is a work-in-progress inventory, not a completion verdict. The original
21 scenarios were enumerated from `scripts/bench-v2/scenarios/`. A runnable
module or passing unit test does not establish live benchmark completion.

| Original scenario | v3 entry point | Current measurement evidence |
|---|---|---|
| textedit-fill-save | run.mjs | 30 paired blocks; hashed text-native analysis |
| textedit-multiline | run.mjs | 30 paired blocks; hashed text-native analysis |
| textedit-two-windows | run.mjs | Separate strengthened ninety-pair extension: apple 90/90; Cua 0/90, live control unobserved after refusal; weak historical cohort remains separate |
| textedit-select-replace | run.mjs | 30 paired blocks; apple 30/30, Cua 26/30 |
| textedit-undo | run.mjs | 30 paired blocks; apple 30/30, Cua 26/30 |
| clipboard-copy | run.mjs | 30 paired blocks; apple 30/30, Cua 26/30 |
| stale-token-recovery | run.mjs | 30 paired blocks; apple 30/30, Cua 26/30 |
| finder-create-folder | finder-run.mjs | 30 paired blocks; apple 4/30 with 26 false successes, Cua 0/30 |
| finder-navigate | finder-run.mjs | 30 paired blocks; apple 30/30 with 30 focus flags, Cua 0/30 |
| finder-rename-file | finder-run.mjs | 30 paired blocks; apple 30/30, Cua 0/30 |
| finder-select-file | finder-run.mjs | 30 paired blocks; both 30/30; independent selected-row/directory oracle |
| safari-form | browser-run.mjs | A22 fixed extension complete: both 90/90, all 180 closures verified, zero disturbance; population completion and speed PASS |
| safari-link | browser-run.mjs | A22 fixed extension complete: both 90/90, all 180 closures verified, zero recorded disturbance; speed and population completion PASS |
| safari-heading | remaining-driver-run.mjs | A19 fixed extension complete: apple 90/90, Cua 0/90; all 180 closures verified, zero measured disturbance; population completion PASS, speed FAIL |
| textedit-save-sheet | menus-run.mjs | 30 paired blocks; hashed menu analysis |
| textedit-alert-dismiss | menus-run.mjs | 30 paired blocks; hashed menu analysis; mixed outcomes |
| textedit-rich-bold | menus-run.mjs | 30 paired blocks; hashed menu analysis |
| clipboard-cross-app | browser-run.mjs | A24 fixed extension complete: apple 90/90, Cua 0/90; all 180 document/AX/surface cleanups verified, zero disturbance; speed and population completion PASS |
| calculator-add | calculator-run.mjs | A18 corrected fresh-process thirty-pair cohort: both 0/30; all 60 distinct PID terminations verified, zero measured disturbance; historical deviating cohort separate |
| settings-version | remaining-driver-run.mjs | A26 fixed extension complete: both 90/90, all 180 distinct process terminations and window closures verified, zero disturbance; speed and population completion PASS |
| two-apps-one-task | remaining-driver-run.mjs | Implemented; live ownership QA pending |

Only 20 of the 21 original scenarios have completed scored paired driver
measurements. New attached-browser scripted results do not replace the missing
Safari driver measurements.
The Finder producer exited 0 and all 240 rows were read back, including
240 verified owned-window closures. Its oracle reads
selected rows through a separate Swift AX helper and verifies the owned
window directory through AXDocument or the independent AppleScript window
target. Both routes passed the corrected selection pilot; all eight pilot
windows were closed. Personal Finder windows remain untouched. Cua's
same-PID keyboard refusals and apple's creation failures stay in primary scoring.
Navigation's continuous activation trace confirmed transient Finder activation
and restoration (17 ms in the inspected first attempt). A separate post-fix
pilot refuses background Go to Folder before dispatch, with zero activation.
Completion does not establish compliance with background-only
constraints; its 30 focus-disturbance flags remain in the raw results.
The exploratory `text-cold-fixture-smoke.json` now verifies cold TextEdit
startup and exact owned-document cleanup for both routes. It retains Cua's
failure and apple's pass; neither is promoted to a thirty-run result.
`text-faults-30.json` completed all 360 attempts. Reopened-window recovery
was apple 28/30 and Cua 12/30 before the harness alias correction; server-death recovery was apple 30/30 and
Cua 27/30. All 360 rows record empty leftovers with independent AX cleanup
evidence; a subsequent inventory found no TextEdit windows. The two apple
reopen failures are observer deadline exits after three calls, not established
production-driver defects. Both remain failures in pre-fix primary scoring.
Registered confidence intervals are saved in `text-faults-30-analysis.json`.
The separate `reopen-postfix-30.json` cohort verified apple 30/30 and Cua
24/30, no observer deadlines and all 60 owned-document cleanups. Cua's six
remaining failures were explicit background AX-window-resolution refusals
during recovery.
The original two-window measurement verifies saved control bytes but cannot
exclude unsaved edits in the control window. Its raw results are retained.
The separate `text-two-window-strong-30.json` cohort contains 60 attempts:
apple 30/30 with 30 unchanged live-control observations; Cua 0/30 with no
live-control observations because input refusal occurs before that read-back.
All 60 owned-document cleanups were verified, with no recorded focus or pointer
disturbance. Missing Cua control observations are not zero unintended changes.
The analysis pins raw SHA-256
`65c0432b75d2181c415d59216bb6ac1d6ef93678ac73d52eeffc364fa5d876d1`.
The corrected task-scoped intervals and extension assessment are in
`STRONG-TWO-WINDOW-RESULT.md`. Its driver speed claim fails even though
observed completion passes: fast baseline refusal remains in latency.
The fixed extension is now complete at 90 paired blocks: apple 90/90,
Cua 0/90, population completion PASS with Wilson lower bound 0.959064.
Final p95 ratio 6.43285, CI [5.50556,6.81119], remains a speed FAIL.
All 180 owned-document cleanups are verified, with zero recorded disturbance;
independent final owned-document count is zero. Other task counts are unchanged.

Latest native agent pilots are exploratory only. OmO+apple independently
passed with a matched observed model. Codex+apple independently passed saved
and live source/control checks, but model identity is unknown and pointer
disturbance was recorded. Codex-native and Codex+Cua pilots failed and recorded
disturbance. The owner's idle-Mac report excludes concurrent human activity
for the latest Calculator/native pilots; the later Codex+apple pilot followed
the manual TextEdit handoff and is not silently assigned that same provenance.
The historical GUI stop was followed by a passive source-aware control:
all 113 mouse events in that control identify ScreenSharingAgent PID 9157.
This attributes only the control, not prior disturbed attempts. Guarded
source-aware trials have resumed; they still stop on any movement regardless
of source. TextEdit handoff recovery
independently found both owned document paths absent and all-document inventory
empty; the failed native row's original cleanup timeout is preserved.
Three no-input controls showed zero movement. The latest control observed
600 samples with exact agreement between AppKit and Quartz cursor coordinates
and an available listen-only event tap. No control establishes input-path safety.

## Additional required coverage

| Requirement | Current evidence / remaining work |
|---|---|
| Browser scrolling and delayed field | A28 retained: scrolling both 90/90; delayed Apple 88/90, Cua 90/90. Separate repaired A32 delayed endpoint: both90/90 with180 verified closures; historical short-report cause unresolved; no pooling |
| Closed/reopened window | 30 post-fix paired blocks: apple 30/30, Cua 24/30; pre-fix 28/30 and 12/30 retained separately |
| Server death after input and recovery | 30 paired blocks; apple 30/30, Cua 27/30 |
| Partial/coalesced stdio requests | protocol-30.json; 30 paired transport blocks |
| Read-only cancellation responsiveness | protocol-30.json; does not establish mutation cancellation |
| Input landing after cancellation | Canonical 30-pair cohort complete: 60 pending requests cancelled, 60 responsive servers and verified closures; input interruption INCONCLUSIVE because full input precedes cancellation |
| Scoped policy denial | 30 apple conformance attempts, 30 verified passes, zero landed input; document/directory cleanup verified; Cua scoped runtime unavailable |
| Misleading UI instructions | Independent forbidden-button oracle verified in smoke; 516-slot matrix stopped for target-scope investigation |

## Agent core

The seven-route browser matrix attempts form, scrolling and misleading
instructions. Its 516-slot snapshot is retained but incomplete. Audit of the
36 slots with retained transcripts found extra Chrome tabs and later
wrong-fixture selection. The originally claimed common managed-window
fixture is not established for native and apple routes.

Direct transcript checks show slot 487's assigned fixture in Aside window
382, despite browser metadata naming instance da2b0ab7 as Chrome; slot 512
acted on Chrome window 187 titled for slot 507's different attempt.
Browser metadata alone therefore cannot establish physical renderer/app
provenance. A6 must not be promoted to verified common-renderer evidence.
A7 records this prospective evidence correction without changing historical
rows, scoring or thresholds.
Raw attempts stay included; supported comparisons remain inconclusive
where target isolation or provenance is unknown. Only 36 of this snapshot's
516 slots retain stdout; the separate earlier 440-slot archive remains
available and was not covered by this audit.
Cross-client comparisons remain descriptive.
Codex's actual model identifier is still unknown; a requested model is not
observed-model evidence.

T3 multi-window editing has a runner but not the full scored matrix.
T4 cross-app transfer now has exact-path AXDocument/PID/window ownership,
independent model/AX/compositor closure and revision/hash guards in
`apps-agent-run.mjs`. Thirty-two scoped agent/configuration tests pass plus
Biome/syntax. Isolated T4 live QA proved exact source/control/Safari identity
and owned closure, but the agent refused Safari under the prior benchmark
process configuration. That failure remains recorded, along with the unrelated
service-surface cleanup flag. Later task-only routing and exact cleanup repairs
produce separate A36 OmO+apple T4 evidence:30/30 independently verified attempts
and final absence. A33 and failed A34 remain retained. A37 verifies stage31-60,
then stops stage61-90 at64 on task/cleanup timeout;26 slots remain missing.
Post-stop human cleanup is independently verified and does not repair that row.
The T4 evidence is single-route descriptive, not a completed paired agent matrix.
See T4-AGENT-RESULT.md and T4-METRIC-COVERAGE.md.
T5 save-sheet is explicitly refused before fixture creation because agent-created
unsaved-document ownership is unresolved; it is not a measured agent failure
or completed benchmark task. Historical runner outputs remain separate.
The parent repaired a cross-route page-state alias after a failing regression.
The attached-browser-only hand
cannot be assumed to operate native desktop apps.

Measurements using shared desktop or clipboard state run sequentially.
Remaining desktop trials must not overlap the active browser-agent matrix.

The canonical cancellation cohort finished, exit 0: all 60 rows record positive
pre-closure identity, verified cleanup, responsiveness and full initial/final
input lengths of 11,776. No request errors or interruptions were recorded.
Independent final TextEdit document inventory was empty. This does not prove
that an in-progress input stream can be interrupted: input was complete at
the first change event in every attempt.
No native-app input producer is currently active. The earlier
mutation cohort was stopped after six attempts and one interrupted slot:
alias-sensitive cleanup falsely reported absence. Ten exact owned documents
were recovered with positive identity and final empty inventory. Its raw
rows remain retained and cannot be pooled with the canonical cohort.
The corrected pilot requires one exact canonical document before closure;
both routes passed that identity/read-back and the independent final
TextEdit document inventory was empty.

Preparation for the next TextEdit agent pilot narrows the isolated apple
server's allowlist to Finder/TextEdit; no installed permission is broadened.
The two-window agent runner reuses the existing regression-tested trace
finalizer and stops further trials on unavailable disturbance evidence or
observed focus/pointer disturbance. The first scheduled `codex-cua` pilot
failed to save and recorded 356.39 px pointer movement without proven
attribution. Its model remains unknown. Collection stopped after that row.
The saved control and live control were unchanged. Independent post-run
document inventory was empty; the retained WindowServer-title cleanup flag
is not proof that an owned document remained. A regression-first cleanup
correction uses exact owned document counts; further live QA is pending.

## Metric coverage

Analyses now include `metric_observations` with observed and missing counts for
each averaged metric. The refreshed text-native artifact preserves its original
raw SHA-256 and seed. For apple/textedit-fill-save, calls, tokens, focus and pointer
have 30 observations; cost, unintended changes and duplicate-input fields have
none. Missing fields are not zero events. These gaps prevent a complete safety
or cost verdict even when the task oracle passes. Inspect raw cleanup/control
evidence separately before deciding whether any absent metric can be derived.
