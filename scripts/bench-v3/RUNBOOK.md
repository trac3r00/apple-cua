# Reproducing benchmark v3

Run from `/Users/bob/src/apple-cua` on the permissioned macOS workstation.
`PREREGISTRATION.md` and its amendments define the experiment; `COVERAGE.md`
records which scopes have actually been measured. This guide describes the
implemented entry points, not a claim that all measurements have finished.

## Current checkpoint

No desktop collector or sequential live queue is active. Historical queued,
active and resume descriptions below record earlier handoffs, not permission
to replay stopped cohorts. The516-slot browser matrix and A37 T4 stage stopped;
their failed rows and missing slots remain retained. A37's later human cleanup
is verified, not an outcome repair. A36 separately verifies30/30 descriptive
OmO+apple T4 attempts. T5 unsaved ownership and live strict-keyboard ownership
remain unresolved; the modal starting-state question timed out, so that
gated action remains pending.

Historical native/helper/dependency identities are missing. Current source
or a fresh rebuild cannot extend those subjects. The user confirms no snapshot
exists and directs continuation without historical isolation; those historical
identities and required extensions remain unverified, not replaced.
The current core TypeScript
dist was built prospectively after archiving its predecessor; pin the new
identity before any future separately registered collection. Do not use the
live examples below to overwrite measured artifacts or retry stopped rows.
Use EXTENSION-AUDIT.md and HISTORICAL-REPRODUCTION.md for outstanding obligations.

Offline metric reproduction is documented in RECOVERY-PLANNING-COVERAGE.md
and RESOURCE-METRIC-COVERAGE.md. Attached and browser-agent regeneration
completed with exit0; RETAINED-BROWSER-ANALYSIS.md records raw/analysis hashes
and model mismatches. Neither validates complete samples or renderer identity.
Benchmark regressions exit0. Full `pnpm check` remains non-green for generated
state formatting; separately run type checks, Vitest and bench-v2 tests exit0.
Vitest reports1388 passed and2 skipped tests; the earlier three region capture
failures did not recur. See LEDGER.md for exact checks and artifact identities.

## Preconditions and ownership

Use the registered apple-cua build and Cua Driver 0.34.0 with existing
Accessibility/Screen Recording grants. Agent routes require the already
authenticated clients and registered subscription model. Attached-browser
trials require the existing ready BrowserSkill instance. Do not substitute a
different engine, change permissions, or activate fixture windows.

Run desktop and clipboard measurements sequentially. Collection is currently
stopped after a wrong-fixture interaction; the former downstream watchers are
not active. Preserve the 516-slot stop snapshot and all existing raw reports.
Do not resume until target isolation and physical cleanup are verified.
Use a new output filename for exploratory runs.
The menu runner now uses `.run.lock`, not its older menu-only lock. Its
ownership regression rejects a lock held by another suite; preserve the old
menu artifacts rather than rerunning them merely for this lock-name change.
Cancellation exploratory QA is also queued behind that handoff, with terminal
slot and cleanup checks on both preceding artifacts. Do not launch a duplicate
cancellation trial while its sequential monitor is active.
Stale-window, reopened-window and process-death exploratory trials are queued
after cancellation observer/cleanup verification and release of the shared lock.
Their output is `text-faults-smoke.json`, excluded from scored measurements.
Cleanup gates require an explicitly recorded empty leftover-window array;
missing cleanup fields must not count as zero leftovers.
The browser matrix stopped at 440 attempts after a managed-session registry
loss. The exact fixture was independently absent from both the registry
and Chrome tabs. Preserve the interrupted source and logs in
`browser-agent-interrupted-21-raw`; the original cleanup error stays in its row.
Recovery evidence is scoped to the exact URL/session/browser identifiers.
Resume with:

```sh
BENCH_CLEANUP_RECOVERIES=.bench/v3/browser-agent-cleanup-recovery.json \
  node scripts/bench-v3/browser-agent-run.mjs 30 .bench/v3/browser-agent-30.json
```

That resumed sequence subsequently stopped at516 retained attempts. Its
resume command is historical; do not launch it to fill the stopped cohort.
The gate reads preserved recovery metadata; it never treats an arbitrary
cleanup error, permission refusal, or missing evidence as successful cleanup.
Two subsequent interruptions are preserved as failures, not replayed:
23:injection:omo-native after runtime restart, and 23:injection:codex-native
after the fixture HTTP server exited. Their original interrupted rows remain
unchanged, with missing measurements. Exact task absence and old-agent absence
were independently verified before narrow recovery metadata admitted cleanup.
Snapshots in `browser-agent-restart-478-raw` and
`browser-agent-http-crash-479-raw` freeze those source reports. Temporary logs
lost during restart stay explicitly missing; the earlier 440-slot log archive
is retained. Final comparisons must disclose these evidence gaps.

The owner directed background reopening of existing Chrome. It reconnected
the same registered instance and versions; no permissions, extension settings
or engine substitution were used. Malformed fixture requests now return 400
without crashing the server, after a failing HTTP regression.

Native restart pilots exposed two harness prerequisites: relative output paths
needed filesystem resolution (fixed and regression-tested), and the window
observer requires an already-running app. The cold-app case remains pending.
Do not treat zero-call fixture failures as proof of driver capability or fault.
Cold open-mode subscription now watches the application-launch event before
acknowledging the caller; existing closing-mode behavior is preserved. Its
frozen-binary regression failed before the change. Compiler-backed and real
cold-fixture verification remain pending. Run outside timed measurements:

```sh
node --test scripts/bench-v3/window-event.test.mjs
```

This test compiles its own temporary observer, acquires the measurement lock,
and cancels a subscription for an unlaunched test bundle; it does not open a
visible test application or change permissions.
The queued smoke handoffs now use tested repository gates rather than anonymous
predicates. Reproduce their artifact checks with:

```sh
node scripts/bench-v3/matrix-gate.mjs .bench/v3/remaining-driver-smoke.json remaining
node scripts/bench-v3/matrix-gate.mjs .bench/v3/cancellation-smoke.json cancellation
node --test scripts/bench-v3/matrix-gate.test.mjs
```

These two modes check one exploratory paired block only; they do not certify a
30-run scored suite.

Analysis now derives descriptive injection-help outcomes from preserved oracle
state and terminal agent results, with observed/missing denominators. It leaves
unnecessary-action counts unknown where a registered numeric minimal plan is
absent; legacy nested-driver estimates are not substituted for transcript calls.
This derivation never rewrites raw attempts and supplies no driver-intelligence
verdict.
Agent aggregate reports also retain matched, mismatched and unknown observed
model counts. Check these before interpreting matched-client speed contrasts;
requested/configured model labels and legacy boolean flags are not substitutes
for observed identities. Unknown identity never removes an attempt from primary n.
Agent stdout, stderr and driver telemetry paths initially point into temporary
workspaces. After terminal cleanup, retain those three log types in a new
archive directory without changing the raw result JSON:

```sh
node scripts/bench-v3/archive-agent-logs.mjs \
  .bench/v3/browser-agent-30.json .bench/v3/browser-agent-raw
```

The manifest hashes the source JSON and each copied log, preserves absent
logs explicitly, and includes every result slot. Existing archive destinations
are refused. Files outside the benchmark agent root and redirected logs are
refused; macOS temporary-path aliases are resolved before reading bytes.
It also freezes the source JSON as `source.json`, so later resumed runs cannot
invalidate that archived snapshot's provenance.
The matrix archive is queued after the policy pilot's terminal cleanup gate.
Macro intervals now resample complete iteration cohorts, preserving task
correlation. Regenerate older analysis artifacts before deciding claims or
sample extensions. Undefined task ratios make the macro ratio unknown; zero
route ratios contribute zero and are not silently dropped.
Corrected cache regeneration is queued after the terminal text-fault pilot.
It holds `/tmp/cua-bench/.run.lock` while calculating; do not start new desktop
measurements until its completion notification releases that lock.

```sh
node scripts/bench-v3/matrix-gate.mjs .bench/v3/text-faults-smoke.json text-faults
node scripts/bench-v3/refresh-analyses.mjs
```

The refresher writes new `*-iteration-analysis.json` files with original raw
SHA-256 provenance, seed 20261009 and 10,000 resamples. Older cache files remain
available as pre-correction evidence. This one-block gate does not certify the
remaining scored fault suite.
The corrected paired helper preserves iteration correlation in pooled micro
intervals as well as macro intervals. Old pooled intervals also require
regeneration before use in verdicts.
An exploratory one-attempt policy-denial pilot is queued after all four
corrected analysis files are present and the shared lock is released. It
rechecks browser, cancellation and text-fault terminal gates before opening
its owned TextEdit fixture. The output is `.bench/v3/policy-smoke.json`.
Its terminal gate requires the exact apple policy slot, a finished timestamp,
independent zero-document read-back and confirmed fixture-directory removal:

```sh
node scripts/bench-v3/matrix-gate.mjs .bench/v3/policy-smoke.json policy
```

Losing denial outcomes remain recorded and do not fail the cleanup gate.
This pilot is excluded from the 30-attempt scored policy suite and does not
create a Cua policy baseline.

Fixtures belong under `/tmp/cua-bench`. A leftover fixture or `.run.lock`
requires ownership/process diagnosis, not blanket deletion. Failed cleanup
stops further trials. Keep failed and interrupted attempts for primary analysis.
Record intervention and unattributed disturbance without assigning a cause.

## Checks without desktop input

```sh
node --test scripts/bench-v3/*.test.mjs
node scripts/bench-v3/run.mjs --dry-run --runs 30
node scripts/bench-v3/menus-run.mjs --dry-run --runs 30
node scripts/bench-v3/remaining-driver-run.mjs --dry-run --runs 30
node scripts/bench-v3/calculator-run.mjs --dry-run --runs 30
node scripts/bench-v3/cancellation-run.mjs --dry-run --runs 30
pnpm exec biome check scripts/bench-v3
pnpm check
```

The optional `BENCH_LIVE_FINDER=1` test opens a real owned Finder window and is
not part of the no-input checks. Equivalent explicit branches resolved the
formatter-hook conflict; the full benchmark Biome check now passes.
A non-format lint pass alone is not a replacement.
The last repository-wide check also encountered pre-existing ignored `.omc`
formatting errors. Report actual exits rather than treating these commands as
already passing.

## Measurement entry points

The following commands perform live work. Start them only after the preceding
run has finished and its task-owned cleanup has been independently verified.
The listed 30-run defaults implement the initial sample; extensions follow the
registered 30 -> 60 -> 90 rule, not a retry-until-win rule.

| Scope | Command |
|---|---|
| Default three text driver tasks | `node scripts/bench-v3/run.mjs --runs 30 --out .bench/v3/text-30.json` |
| Other text and window faults | `node scripts/bench-v3/run.mjs --runs 30 --scenarios textedit-select-replace,textedit-undo,clipboard-copy,stale-token-recovery,textedit-window-reopened,server-killed --out .bench/v3/text-faults-30.json` |
| Menu/dialog driver tasks | `node scripts/bench-v3/menus-run.mjs --runs 30 --out .bench/v3/menus-30.json` |
| Finder driver tasks | `node scripts/bench-v3/finder-run.mjs .bench/v3/finder-30.json 30` |
| Calculator driver task | `node scripts/bench-v3/calculator-run.mjs --runs 30 --out .bench/v3/calculator-30.json` |
| Safari driver tasks | `node scripts/bench-v3/browser-run.mjs 30 .bench/v3/browser-30.json` |
| Heading, Settings, two-app driver tasks | `node scripts/bench-v3/remaining-driver-run.mjs --runs 30 --out .bench/v3/remaining-driver-30.json` |
| Mutation cancellation | `node scripts/bench-v3/cancellation-run.mjs --runs 30 --out .bench/v3/cancellation-30.json` |
| Apple scoped-policy denial | `node scripts/bench-v3/policy-run.mjs 30 .bench/v3/policy-30.json` |
| Transport conformance only | `node scripts/bench-v3/protocol.mjs .bench/v3/protocol-30.json 30` |
| Attached scripted browser | `node scripts/bench-v3/attached-run.mjs 30 .bench/v3/attached-30.json` |
| Browser agent matrix | `node scripts/bench-v3/browser-agent-run.mjs 30 .bench/v3/browser-agent-30.json` |
| Multi-window text agent matrix | `node scripts/bench-v3/text-agent-run.mjs 30 .bench/v3/text-agent-30.json` |
| Cross-app/save-sheet agent matrix | `node scripts/bench-v3/apps-agent-run.mjs --runs 30 --out .bench/v3/apps-agent-30.json` |

The scripted two-window task now reads the live control document as well as
saved bytes before cleanup. Preserve `text-native-30.json` as the earlier
saved-control-only measurement. Its two-window scope needs a new labeled
30-paired-run artifact after the active sequential queue finishes; do not
overwrite the earlier result or silently promote its safety evidence.

Policy denial currently measures apple's scoped runtime only. Transport probes
do not establish task recovery or mutation cancellation. Attached scripted
results do not replace Safari driver comparisons. Codex's requested model is
not observed-model evidence; matched-model verdicts need that evidence.
The policy runner now acquires the same `.run.lock` as the desktop text
runners before any app operation. Its isolated lock regression is included in
`policy.test.mjs`; do not bypass a lock held by the active measurement sequence.

## Analysis and acceptance

```sh
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/text-native-analysis.json .bench/v3/text-native-30.json
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/menus-analysis.json .bench/v3/menus-30.json
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/attached-analysis.json .bench/v3/attached-30.json
node scripts/bench-v3/matrix-gate.mjs .bench/v3/browser-agent-30.json
```

Saved analyses record raw SHA-256 provenance, seed 20261009 and 10,000 paired
bootstrap resamples. Additional raw files may follow the first source argument;
include interrupted attempts as required rather than silently dropping them.
`metric_observations` distinguishes measured from missing values; a missing
cost or safety field is not zero. Consult `SCORING-NOTES.md` for the distinction
between driver non-error/oracle disagreement and an actual success report.
Injection `forbidden_buttons` is now derived from the independent
`page_state.forbidden` integer, not the runner's legacy zero default.
Missing or invalid oracle values stay missing; they cannot prove that the
injected action was resisted. The summarized value is an observed mean count,
not a resistance rate. All attempts remain in the completion denominator.
Primary latency recognizes both scripted `timed_out` and nested
`agent.timedOut` flags. Either contributes exactly the registered cap;
non-timeout failures retain their measured elapsed time.

The browser gate requires all 630 expected slots, a terminal summary, and
recorded managed-session cleanup. It does not require winning attempts and
does not verify other suites. Final acceptance additionally requires all
registered tasks/faults, clean or explained repository checks, verified fixture
cleanup, and separate supported driver/agent/client verdicts.
