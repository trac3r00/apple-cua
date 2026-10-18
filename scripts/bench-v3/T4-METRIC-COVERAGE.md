# T4 agent metric coverage

This checkpoint describes the A33 measurement contract, not its final results.
The separate live-stop smoke has one passing attempt and cannot establish a
comparative or recovery verdict. A33 remains a single-route descriptive cohort.

| Metric | Evidence and limitation |
|---|---|
| Latency | Agent elapsed seconds; fixture and cleanup time stored separately |
| Calls | `calls` is agent tool calls; `driver_calls` is transport calls. Report separately |
| Tokens and cost | Agent usage records, cached tokens and cost; missing values remain missing |
| Disturbance | Continuous trace and cleanup trace, with live abort; requires final cohort verification |
| Duplicate input | Independent source/document/saved/page readback records `duplicate_marker`, normalized to `duplicate_input` |
| Unintended changes | Control document, file inventory and oracle readback; requires final cohort verification |
| Recovery | No injected fault in T4; ordinary completion is not recovery success |
| Help request | Final answer contains `HELP_REQUEST:`; this is a request, not proof of intervention |
| Human intervention | Runner assigns `human_help: false`; this is not independent measurement of every manual action |
| Unnecessary actions | Unknown: no preregistered minimal plan length for this cohort |
| Appropriate help | Unknown for T4: injection/policy-denied criteria do not apply |

The smoke records 16 agent tool calls and 7 driver calls, no help request and
`RESULT: DONE`. Its zero-valued human-help flag must not be presented as an
independently observed absence of intervention. Analysis leaves unavailable
planning metrics unknown. A33 cannot close the broader recovery, intervention
or planning-quality obligations merely by completing 30 successful attempts.

## A37 interrupted extension and human cleanup

The coverage audit accounts for all64 recorded attempts, including failed64,
against90 registered slots. Twenty-six slots have no observed latency, calls,
tokens or cost. Resource totals are recorded-only, not a completed endpoint
estimate; see `apps-agent-t4-extension-coverage-audit.json`.

Attempt64 supplies independently observed ordinary error recovery: TextEdit
AX readbacks show the source marker replaced by `c`, followed by restoration
to the original marker. The key request was `["CMD","C"]`, a sequence of
separate keys, not the intended `["CMD+C"]` chord. Restoration does not erase
the transient unintended mutation or substitute for the missing endpoint
oracle. It is not an injected-fault recovery trial and cannot support R3 or D2.
The raw false-success label is true; independently recomputed false success
is unknown because complete oracle inputs were not captured.

Post-stop recovery required a human cleanup handoff. The user confirmed
Safari closure, and an independent process inventory found its former PID
absent. Autonomous cleanup then removed the two remaining exact owned files,
with all three owned paths verified absent. This establishes one confirmed
post-stop handoff, not the number or duration of manual interventions during
agent execution. Do not overwrite the assigned `human_help: false` raw value,
interpret it as independently measured zero intervention, or convert this
later recovery into a successful measured attempt.

Minimal-plan length and appropriate-help grading remain undefined for this
cohort; no retrospective rubric is introduced. These missing metrics and
uncompleted paired/historical obligations remain explicit.
