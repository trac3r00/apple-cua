# Interpretation constraints

Driver token fields are response-size estimates (UTF-8 bytes/4 plus an image
area estimate), not measured LLM usage or billed cost. Agent usage records
and separately reported cached tokens are a different evidence level.
The Calculator producer additionally counted its image component twice.
Original raw fields stay retained; CALCULATOR-RESULT.md discloses the
separate reconstructed single-count sensitivity analysis and prospective fix.
Do not compare the uncorrected Calculator proxy or any driver estimate with
actual agent usage as if they were the same measurement.

The preregistered driver `false_success` proxy is **not** equivalent to a
driver reporting complete task success. It means every prescribed tool call
returned without `isError`, but the independent task oracle failed.

Cua Driver 0.34.0 explicitly documents `press_key` returning
`effect:"unverifiable"` when it cannot confirm a value or selection change.
That is an honest uncertainty report, not a false claim that a task completed.
The original proxy remains in raw results and preregistered summaries; it is
not retroactively rescored. Reports must label it “non-error plan/oracle
disagreement” and must not use it to claim Cua fabricated success.

For driver-level F1/F1p, actual task-success reports are unavailable from the
prescribed-action API. Those report-based claims are INCONCLUSIVE at that
evidence level. Agent-level false success remains independently scoreable:
`RESULT: DONE` plus a failed outcome oracle.

The full historical text-fault raw audit is preserved in
`.bench/v3/historical-recovery-missingness-audit.json`, with the raw SHA256
and per-task/route counts. Of180 actual fault-task rows, recovery_success is
observed in161; all19 missing values belong to reopened-window attempts.
Non-fault rows have no recovery field by design. Duplicate and unintended-change
fields are each missing in22/360 rows. Do not replace missing values with false
or calculate safety from only successful attempts without disclosing missingness.

These driver rows contain no human-intervention or planning measurements.
T4 agent `human_help: false` is assigned by the runner, not an independent
manual-action observation; a HELP_REQUEST marker is a request, not intervention.
Unnecessary-action counts remain unavailable without a preregistered minimal
plan length. Preserve these distinctions in descriptive reports.

Background-only results must name that condition. Both engines can support
different foreground recovery routes, but those were not authorized in these
trials. Results must not imply a ranking across unrestricted desktop use.

Live Cua Driver 0.34.0 `tools/list` inspection also documents the `page` tool
as the reliable browser-tab path through CDP. Its `type_text` description
recommends pixel typing for embedded web views and foreground recovery if
background pixel typing drops. Amendment A1 registers background element/pixel
actions for the scripted comparison, not the CDP page route. Report Safari
results as that registered action-path comparison, not a test of Cua's strongest
browser capability. Changing paths after observing outcomes would require a
separate disclosed experiment; it must not replace the registered raw results.

The first text measurement used an unreliable Node filesystem subscription.
Keep it and its monitor interruption artifact as pre-fix evidence. The native
registered-event rerun is the corrected outcome measurement. Neither the
pre-fix failure nor the interrupted attempt may disappear from the report.
