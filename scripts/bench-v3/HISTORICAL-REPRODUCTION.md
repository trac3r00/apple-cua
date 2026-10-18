# Historical subject reproduction checkpoint

## User correction and disposition

On 2026-10-11 the user clarified: "No snapshot exists; I never made one.
Proceed without historical isolation and say what that leaves unverified."
Historical isolation is abandoned at the user's direction. Earlier references
to an available snapshot and requests for its path are superseded.

The exact measurement-time native binaries, core/MCP compiled modules,
dependency identities and complete harness bytes remain unverified for the
five cohorts below. Recovered source candidates and raw hashes do not prove
their producer's identity. Required historical 60/90 sample extensions remain
unperformed, not statistically satisfied or replaced by current-build rows.
Population reliability and full-suite superiority claims requiring those
extensions remain inconclusive. Existing failures, weak-oracle limitations
and safety findings stay retained. Separately registered prospective evidence
may proceed through its own ownership and cleanup gates without being pooled
with historical cohorts.

Read-only investigation on 2026-10-11 establishes source reconstruction
feasibility, not exact historical executable or harness reproduction.
No isolated build or GUI collection has been performed.

The historical commit e62e06f76ea60181ee45de79fb4cc05e533dc8d0 exists
locally and contains sources, pnpm lockfile, native binaries and v2 harness.
It contains neither tracked core/MCP dist nor the v3 harness. HEAD remained
unchanged while working sources and untracked harness files changed.
Consequently, a commit field in a raw artifact does not attest to the source
tree, compiled modules or experiment plan used at measurement time.

| Cohort | Raw subject provenance | Missing reproduction evidence |
|---|---|---|
| text-native-30 | Full e62e06f commit | Built/source/harness hashes; weak two-window oracle revision |
| menus-30 | No commit field | Exact native and harness identities |
| text-faults-30 | Full e62e06f commit | Built/source/harness hashes; pre-alias reopen revision |
| finder-30 | No commit field | A8 harness sources and pre-A9 native identity |
| reopen-postfix-30 | Full e62e06f commit | Alias-corrected harness and executable hashes |

The investigation independently rehashed all five raws and matched the
identities in EXTENSION-AUDIT.md. Those hashes identify measurement artifacts,
not their producer. finder-postfix-subject.json pins A9 and cannot be applied
retroactively to finder-30.

## Safe prospective reconstruction

A separate clone, detached at the recorded commit, can preserve shared sources,
dependencies and dist. Validate committed native/build-inputs.sha256 before
using native binaries. Use the recorded pnpm10.30.2 and frozen lockfile, then
core build:ts and MCP build, deliberately avoiding the native rebuild command.
Retain dependency/toolchain/runtime versions and hashes of all built modules,
native inputs, adapter/helper/oracle sources and comparison binary.

Copying current v3 harness sources into that clone would make a separately
labelled prospective reconstruction, not a historical continuation. The runners
resolve isolated modules from their repository root, but still share the
desktop, /tmp/cua-bench lock and installed Cua daemon. Code isolation provides
no desktop isolation and cannot justify repeating known focus-stealing Finder
navigation under the user's background-only requirement.

Historical menu/Finder runners also need continuation scheduling verified:
their inspected interfaces do not support start-iteration, unlike the text
runner. Restarting at iteration1 would repeat random ordering and identities.

## Next evidence source

Search contemporaneous session tool records for complete original file
creations, edits and build outputs before declaring the missing revisions
irrecoverable. Recorded edit chains may reconstruct a source candidate;
they still need successful tool results and measurement-time build evidence
to establish identity. No historical 60/90 obligation is discharged merely
by a new rebuild, and old outcomes remain scored without pooling.

### Located archive evidence

The broad Senpi finder returned no matching sessions, but a direct read of
the known session succeeds:
`~/.omo/agent/sessions/--Users-bob-src-apple-cua--/2026-10-09T08-16-59-921Z_01a11fbc-a811-7c80-a87b-eeb9c72bfbb7.jsonl`.
Line290 contains a complete 7039-character apply_patch input inserting the
initial run.mjs into the previously empty file at 2026-10-09T14:20:32.411Z;
line291 records successful update and automatic formatting. Later recorded
patches precede the initial collection launch at line470. This changes the
next action from speculative reconstruction to replay/audit of an available
edit chain. Formatting modifications and dependency/native build identities
still require recovery; the initial patch alone is not a measurement snapshot.

Recovered artifacts now live under `.bench/v3/history/`:
`text-runner-initial-20261009.mjs` preserves the complete initial source, and
`text-precollection-edit-chain.json` preserves twelve later timestamped patch
records, including the first disturbance-helper implementation. No archived
code was executed. Syntax-only check exits0. Initial-source SHA256 is
48c5fe82f0e9812917ef40b5c07386cb15dcee3264cbe85b1559513c16824986;
edit-chain SHA256 is
f62954f17f344b4da14067b4356f526a87bab432f7d4c41b66ee4d6e94006155.
These records precede the first interrupted text collection; subsequent edits
before the retained text-native-30 run must also be recovered. The files
explicitly retain formatting, successful-result matching and executable
identity gaps. They do not authorize use of the early runner for GUI trials.

`text-retained-cohort-boundary.json` now preserves the acknowledged
expectFile correction at line586 (2026-10-09T14:46:50.001Z) and the retained
text-native-30 launch at line600 (14:48:06.937Z). That command first runs
browser smoke and then starts text collection. Line602 adds fault branches
at14:48:39.314Z while the pipeline is active, so command-launch time alone
does not prove which run.mjs revision the later text process loaded.
The earlier resume patch at line535 is independently confirmed successful
by line536. Exact process-load boundary and native module provenance remain
unresolved; the recovered records are evidence, not an extension-ready subject.

Full retained text raw inspection finds180 rows and no actual_file,
duplicate_input or recovery_success fields. Line602 introduced actual_file
on the successful path irrespective of fault scenario, so absence from all
successful text rows supports the process having loaded the pre-line602 runner.
This is behavioral discrimination between recovered candidates, not a byte
identity proof; native dependency/build provenance and complete edit replay
still need verification.

`text-patch-result-audit.json` matches all twelve precollection patch calls
to successful results with empty failure lists. The disturbance patch result
is at line417, not the immediately following custom record at line416.
Formatter changes are explicitly recorded for the initial runner and later
runner, window-event and disturbance edits; their exact resulting bytes remain
unrecovered. Contemporaneous partial runner reads occur at lines303,306,330.
Historical LSP freshness timeouts are retained as such, not code errors or
clean diagnostics. Successful patch application closes that evidence gap only;
it does not establish measurement-time executable identity.

`text-formatted-fragments.json` preserves the three partial readbacks with
matching read tool-call identities: lines1-65,113-end at the early revision,
and lines74-89 after the indentation edit. The returned pagination notices
are retained as metadata, not source. These fragments can constrain replay
of formatter changes; the intervening source and later revisions still require
reconstruction. No archived runner or desktop action was executed to recover them.

Offline in-memory replay matched edits294 and308 by unique normalized line
context, then refused edit328: the initial formatter split the original
single-line client expression and added a trailing argument comma. The archived
read at330 confirms that layout difference. `text-replay-audit.json` preserves
this boundary; no partial candidate was emitted or executed. Recovering the
complete formatted initial runner or the historical formatter/configuration
is necessary before treating a replay as a source identity.

A second, stdin-only experiment with the installed Biome exits0 and exactly
matches the archived first65 lines after edit294, but not the archived tail
at113-end. Its replay therefore stops earlier, at308, where line wrapping
differs. `text-formatter-experiment.json` records this counterexample:
whole-file formatting with the present configuration does not reproduce the
historical file. No shared source was modified and no candidate was executed.

The additional archive pass recovers formatter preview318/319 and runner
reads343/344 (132-179),391/392 (141-174),409/410 (160-end) and573/574
(17-161 at the later218-line revision). Parent call/result identities match.
`text-additional-source-evidence.json` preserves the runner-only formatter
preview and these fragments. The preview contains historical old/new ranges
1-13,29-37/29-39 and67-143/69-179, resolving the previously missing substantial
formatter transformation. Nested call arguments are truncated; the full result
preview is available. Its subsequent automatic-format diff and formatter571's
replacement bytes remain absent. No complete pre-launch snapshot was found;
later source ranges1-16 and162-218 still need reconstruction.

The runner preview's204 quoted chunks were decoded using JSON5 string parsing,
without evaluating archived JavaScript. `text-formatter-318.patch` preserves
the resulting9446-byte unified patch with three exact hunk headers. Combined
with the early1-65 read, its old67-143 range nearly covers the pre318 runner;
line66 and intervening edit308 still require explicit reconciliation. This
decoded transformation is not itself a complete executable candidate.

Reconciliation now reproduces the archived113-end tail exactly after reversing
edit308, and applying the recovered318 transformation yields179 lines.
Edits328,332,350,359,371 and393 then replay with unique normalized context.
Line66's `try {` remains an explicitly inferred boundary from the initial
creation and surrounding reads. Edit415 stops on a bare closing-brace hunk
with ten possible positions; an ordered/full-context replay is required.
`text-replay-after-318.json` preserves these checks. No candidate is emitted,
and no executable identity or extension readiness is claimed.

Ordered replay resolves415's brace as the first closing brace after its
`if (before)` hunk, then applies421,442,468 and resume535. Stdin-only formatting
of that reconstructed revision exactly matches all145 archived source lines
17-161 at573. Applying the acknowledged expectFile586 correction produces
`text-retained-runner-candidate.mjs`, isolated under the history directory.
This is a constrained candidate, not a proven measurement snapshot: inferred
line66, unobserved later prefix/tail bytes, helper/dependency sources and built
module identities remain gaps. Do not import or run it for collection.

Executable-provenance investigation finds an early install/build at archive24
and matching result49: MCP/CLI/agent report Done, but the unguarded `build | tail`
pipeline retains neither underlying build exit nor core/native output. More
decisively, result124 records both native cursor-overlay and libsckit.dylib
modified before scored collection. Committed native binaries therefore cannot
substitute for measured bytes. Parent-checked records are preserved in
`historical-build-provenance.json`. The later A9 manifest at4274 explicitly
postdates original cohorts. No original native/core/MCP hashes were recovered;
all four historical cohorts remain unready for exact-subject extensions.
