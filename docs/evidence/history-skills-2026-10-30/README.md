# History workflow verification

The subsequently approved installed rollout is recorded in `ROLLOUT.md`.
The source-phase limitations below are historical; consult that receipt for
the installed CLI, recorder, real-data fix and preservation checks.

The `fixtures/` tree is synthetic input, not captured user activity.
Its semantic targets are deliberately richer than the current native recorder
emits. Model generation on this fixture cannot prove native capture completeness.

## UI design brief

Primary action: create a skill draft from selected recorded activity.
Reading order: recording state and activity selection, evidence review and
generation, editable draft and explicit save. Saved summaries remain available
after the raw events expire.

Layout: history review uses a list-detail grid, with the document as the vertical
scroll owner; at narrow widths the activity list precedes the detail form.
Unbroken labels wrap. There are no nested scrolling panels except evidence and
instruction text areas, whose explicit job is bounded long-form review.

Use native HTML controls, system fonts, 8 px corner radii and 8/16/24/32 px
spacing. Light: background #f5f5f7, surface #ffffff, text #1d1d1f, secondary
#56565c, border #86868b, action #0066cc with white text. Dark: background #171719,
surface #262629, text #f5f5f7, secondary #c4c4ca, border #8d8d94, action #8bc5ff
with #111111 text. Buttons have 44 px minimum height and visible keyboard focus.
No remote assets, decorative metrics, animation, or inferred success badges.

## Evidence ledger

- VERIFIED: 48 focused Vitest tests passed across the six history workflow,
  adapter, HTTP, service, digest and demonstration files.
- VERIFIED: CLI production typechecking passed. Native recorder syntax checking
  passed with `clang -fsyntax-only -fobjc-arc -mmacosx-version-min=15.0`.
- VERIFIED: the initial HTTP run had 5 passes and 1 failure. First-use save
  required an existing skills directory; the implementation now creates it
  safely. A later fixture failure used macOS's symlinked temporary path and was
  fixed by canonicalizing the test-owned path, not weakening symlink checks.
- VERIFIED: the model adapter was independently reviewed. Cancellation now uses
  SIGKILL rather than relying on a child honoring SIGTERM.
- VERIFIED: the real source CLI served a loopback UI. A real OmO model generated
  a skill from the four synthetic TextEdit events. The UI review/save flow wrote
  `generated-skills/textedit-bold-selected-heading/SKILL.md`.
- VERIFIED: two real digest attempts returned schema-invalid output. Explicit
  output constraints were added to the generation contract; the subsequent real
  command returned `{"state":"created"}` and the resulting suggestion appeared
  in the UI. Its persisted evidence is under
  `fixtures/cua-history/summaries/auto-2026-10-29T20-00-00Z.json`.
  The original two model responses were not retained, so no minimized
  reproduction of those nondeterministic responses is claimed.
- VERIFIED: clicking the generated suggestion selected its source and populated
  the workflow goal without enabling model sharing.
- VERIFIED: the demonstration UI created a marker from
  `2026-10-30T02:43:15.000Z` to `2026-10-30T02:43:39.000Z`; preview contained only
  the synthetic event at `02:43:16Z`. The fixture's `state.json` is simulated
  recorder state, not evidence of native capture.
- VERIFIED: changing selected activity clears the previous evidence preview.
- VERIFIED: HTTP regression covers creating a draft from an explicitly labelled
  saved summary after its raw segments have been removed.
- VERIFIED: browser captures were inspected at desktop width 1440 and mobile
  widths 390 and 320, in dark and light modes. No horizontal overflow was observed.
  Keyboard Tab moved from the workflow input to its consent checkbox with a
  visible solid focus outline. The final saved-summary preview identified its
  evidence as `generated-summary-not-raw-events`. Full WCAG conformance is not
  claimed from these bounded checks.
- VERIFIED: the consumer command accepted the generated skill path and exited
  zero. Its diagnostic report listed zero model tools. This is loader evidence,
  not proof of a successful native replay.
- BLOCKED: native replay of `replay.rtf` was refused by the existing user stop
  switch, timestamp `2026-10-29T17:16:29.642Z`. The response explicitly reported
  `actionDispatched:false`. The switch was not changed. The disposable document
  remains open in TextEdit because no alternative input path was used to bypass
  the stop.
- PRE-EXISTING: repository-wide test typechecking reports five TS4111 errors in
  untouched files: `history-capture.test.ts:63,74,83` and
  `history-tools.protocol.test.ts:78,79`. These were not edited to make the run green.
- NOT DEPLOYED: the installed CLI/native recorder has not been rebuilt or
  restarted. Source verification does not establish that the user's existing
  menu now contains the new controls.

## Deterministic generated campaign

This is property testing, not coverage-guided fuzzing. Runner: Vitest 2.1.9
as reported by the local runs. Platform: macOS arm64. Starting revision:
`7f4e0f8ab3df896c7eabf687ffeafd8a2598fbe0`, with pre-existing dirty history and
unrelated work preserved.

| Property family | Attempted | Executed | Discarded | Failing assertions |
|---|---:|---:|---:|---:|
| Valid slug lengths and Unicode body, seed `0x5eed` | 64 | 64 | 0 | 0 |
| Invalid slugs plus defective-draft calibration | 7 | 7 | 0 | 0 |
| Unicode subprocess prompt transport | 12 | 12 | 0 | 0 |
| Invalid HTTP save names | 10 | 10 | 0 | 0 |
| Missing/invalid model consent | 6 | 6 | 0 | 0 |
| Structured digest output families | 7 | 7 | 0 | 0 |
| Demonstration event/time boundaries | 4 | 4 | 0 | 0 |
| Invalid/unknown demonstration IDs | 3 | 3 | 0 | 0 |
| Total | 113 | 113 | 0 | 0 |

Expected rejections are executed assertions, not discarded inputs or failing
properties. The six deliberately invalid digest outputs are expected rejections.
Handwritten integration and boundary scenarios are additional tests, not
inflated generated-case counts.

The oracle uses explicit schema constraints, independent time-boundary expected
values, subprocess stdin/argv observations, and filesystem postconditions.
Calibration includes an unsafe/oversized draft and malformed model outputs,
which must reject before installation. No test depends on fixed sleeps.

Limits: 12 selected segments, 120,000 evidence/prompt bytes, 256 KiB per model
output stream, 120-second generation deadline, and a 90-minute demonstration
limit. Tests use bounded fixtures and task-owned temporary directories with
teardown; no process RSS limit or coverage-guided mutation engine was used.

Replay:

```sh
pnpm exec vitest run --reporter=dot \
  packages/cli/src/history-ui.test.ts \
  packages/cli/src/history-agent.test.ts \
  packages/cli/src/history-workflows.test.ts \
  packages/cli/src/history-service.test.ts \
  packages/cli/src/history-digest.test.ts \
  packages/cli/src/history-demonstration.test.ts
pnpm exec biome check packages/cli/src/history-*.ts
pnpm --filter @apple-cua/cli typecheck
```

## Limits

This is not evidence of Codex UI pixel parity, full native capture/privacy parity,
a live installed-recorder timer run, successful native replay, or multi-agent
live document coauthoring.

## Cleanup and pending rollout

All task-owned history UI servers and browser views were closed. Their shell
wrappers removed their own temporary installation directories on exit. Generated
test data, the skill and the unmodified RTF are retained in this evidence
directory, not temporary storage. Synthetic automatic sharing was turned off.

The read-only resume monitor `mon_AAK8RH4A9KNCAMKJ` was stopped when the scoped
source-work goal closed. The user stop file was not removed or modified.
Native replay and installation are not complete. Installation is a separate,
unapproved follow-up, not a completed rollout. The existing installation has
not been changed, and no Git commit was created.
