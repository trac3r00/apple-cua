# macOS task benchmark v2

Run only on an **unlocked**, attended test Mac with Accessibility and Screen Recording permissions for both drivers. The harness refuses live runs when `ioreg -n Root -d1 -a` reports `IOConsoleUsers.CGSSessionScreenIsLocked=true` (or the lock state cannot be read). Start Cua Driver's daemon before running: `open -n -g -a CuaDriver --args serve`. Build the apple-cua MCP server first with the repository's normal build. Safari fixtures are served from a loopback HTTP server on a random port; JavaScript from Apple Events is **not** required. Do not run this on a Mac where you need the foreground apps left untouched.

```sh
node scripts/bench-v2/run.mjs --dry-run
node --test scripts/bench-v2/*.test.mjs
# After unlocking the Mac and starting both servers:
node scripts/bench-v2/run.mjs --drivers apple,cua --runs 1 --scenarios textedit-fill-save
node scripts/bench-v2/run.mjs --drivers apple,cua --runs 5 --scenarios all
node scripts/bench-v2/run.mjs --drivers apple,cua --runs 5 --scenarios all --out .sisyphus/evidence/bench-v2/manual.json
node scripts/bench-v2/dashboard.mjs
```

One module per scenario lives under `scripts/bench-v2/scenarios/`. Fixtures, assertions, and cleanup are owned by the harness, not the driver. The scripts touch only Finder, TextEdit, Calculator, Safari local `http://127.0.0.1` pages, and read-only System Settings; scratch content and deletions are confined to `/tmp/cua-bench`. The clipboard's pasteboard items and data flavors are archived with AppKit and restored in `finally`, including on exceptions. If restore itself fails, the archive remains at `/tmp/cua-bench/clipboard-*.plist` for manual recovery with `swift scripts/bench-v2/clipboard.swift restore <archive>`; never delete it until restored. A `.run.lock` in that directory prevents concurrent benchmarks; after a crash, remove that lock only after confirming no benchmark remains running. Before the run and before every attempt, the harness snapshots running app bundle IDs and on-screen window IDs/titles. After each attempt and at run end it quits apps that were not running before the run, closes only newly opened fixture windows in pre-existing apps (unique-title AppleScript close, then window-targeted Cmd+W only when AX confirms that window is focused), and closes fixture Safari tabs by their unique local URL. Every AppleScript has a hard subprocess timeout (cleanup calls: 5 seconds). If an app launched by the run fails to quit within 5 seconds, the harness sends SIGTERM, then SIGKILL after 2 more seconds if the same PID/bundle still runs; apps running before the run are never force-quit. Both paths verify the result; forced signals and remaining windows/tabs are printed to stderr and recorded as `cleanup: {closed, quit, forced, leftover}` per attempt and at the report root. The dashboard reports cleanup counts, forced terminations and final leftovers. In off-console sessions, background mouse clicks may miss and File > Save can be disabled because there is no key window; those are driver outcomes, not changed scenarios or relaxed oracles. The harness refuses to reuse a TextEdit fixture-named document already open before an attempt instead of closing it. Inspect any leftovers before starting another run. A scenario may change the visible desktop, open windows, or move its own TextEdit window. Only the harness's loopback HTTP fixture receives page-state POSTs; no external network endpoints, account apps, submissions, or mail/message operations are in the plans. In the two-app case both file contents and Finder's target folder are asserted; the undo case independently checks the temporary in-memory state before undo; the stale-token case moves the window between observations.

A **run** is one attempt for each selected scenario and driver; `n` is the number of attempts, not a confidence interval. Driver-specific MCP calls translate the same task steps into apple-cua's observed one-use tokens and Cua Driver's `(pid, window_id)` targeting, including its documented foreground retry for multi-window keyboard ambiguity. The server is persistent per driver. Fixture setup, app activation, oracle queries, and clipboard restore are outside measured call time. Every tool call is a turn; `seconds` sums end-to-end tool-call wall time, including errors and timeouts. A dead stdio server rejects outstanding and future requests immediately; each request has a 30-second cap. A failed step stops the plan but the external oracle still runs. Safari page events (load, input/change, hashchange) report a per-load nonce, field value, hash and rendered heading to the loopback server. The oracle also checks Safari's front-document URL; heading requires a load nonce newer than fixture setup. Finder create/rename outcomes are read directly from disk; navigation reads Finder's target alias and selection reads a selected alias path with an empty selection treated as a mismatch. The result JSON is written after each attempt to preserve partial evidence.

`pass` is solely the harness oracle. `fixture-infra` means fixture setup, a fixture-only step or desktop probe could not run; `oracle-infra` means the oracle itself errored (for example Finder or AppleScript could not read a selection). Those attempts are shown in a separate dashboard Infra count and excluded from pass/fail and gave-up/false-done denominators, not converted into driver failures. An empty Finder selection and an absent page-state match are genuine oracle mismatches. Other error classes (`tool-error`, `protocol-error`, `server-exit`, `timeout`, `target-missing`, `driver-error`, `oracle-mismatch`) remain driver outcomes. `gave_up` means the oracle failed and a driver refusal, timeout, or dead server was observed. `false_done` means the oracle failed although a successful/verified/completed driver claim was observed (not a qualified "unverifiable" claim). `human_ask` flags driver text matching an ask-user, `needs_user`, or elicitation signal. These classifications are heuristics over driver MCP responses, **not** an LLM-agent benchmark: the same deterministic step plan drives each side, and no model-inference time or tokens are counted.

`text_bytes` includes UTF-8 response text and serialized structured content; `image_base64_bytes` counts the model-facing encoded image characters. `estimated_tokens = text_bytes / 4 + sum(ceil(image_width * image_height / 750))` for PNG/JPEG screenshot blocks. Unknown image dimensions contribute zero image tokens, not an invented estimate. `payload KB` uses `(text_bytes + image_base64_bytes) / 1024`; p50 seconds is the median of run-level summed driver-call seconds, whereas calls, payload, and tokens are mean per attempt. `call_ms` stores each individual tool call's wall-clock latency including failed calls; the dashboard pools calls by driver for p50/p95 (linear percentile interpolation). `disturbed_focus` compares the frontmost application bundle ID before the first and after the last driver call; `disturbed_pointer` compares hardware cursor coordinates at those points (>2 pt Euclidean motion). `Disturbed user` is the percentage of measured attempts with either flag. Fixture setup activations, oracle reads and clipboard restoration are excluded; these endpoint probes do not detect intermediate changes that are undone before the final probe. Legacy records store whole-response `payload_bytes`, not split bytes; their chart bars are approximate and **not directly comparable** to v2 bars. Legacy estimated tokens and classification rates remain `not measured` rather than zero. Summary success rates weight individual attempts; per-commit trends include only v2 evidence with a commit hash. Dirty-tree runs carry `dirty: true` and should not be attributed to the commit alone.

Evidence defaults to `.sisyphus/evidence/bench-v2/<ISO>-<shortsha>.json`; the static self-contained dashboard is `docs/bench/dashboard.html`. The dashboard also loads the checked-in 2026-09-17 legacy task shootout. Its provenance table states what was included. Unit tests run under **node:test**, not Vitest (the repository's Vitest glob covers only `packages/**/*.test.ts`).

## Results: 2026-09-24, apple-cua, on the physical console

Run 16, stored as `.sisyphus/evidence/bench-v2/2026-09-24-run16-apple-console.json`, with background delivery (the default) while a person was at the machine:

| Metric (105 attempts) | Run 1 (off-console baseline) | Run 16 (console) |
| --- | --- | --- |
| Pass | 27 | **105** |
| p50 / p95 call ms | 5185 / n/a | **159 / 458** |
| Calls per task | 2.8 | 6.4 |
| Estimated tokens per task | 1659 | 4115 |
| Focus changed / pointer moved | 1 / 5 | **0 / 1** |
| Attempts with cleanup leftovers / forced cleanups | 20 / n/a | **0 / 0** |

All 21 scenarios pass 5/5. The single pointer reading is in `finder-navigate`, which sends only keys, so it was most likely the person's own mouse. The metric cannot tell whose hand moved the pointer.

Driver changes found on the console:

- A pressed text field is focused with AXFocused. Typing into web content uses real key events, because pages ignore accessibility writes.
- Keys for an open Save or Open panel go to AppKit's panel service process, the only place they are received.
- Cmd+V into a web page of a background app types the clipboard's plain text, because WebKit pastes only for the active app.
- The focus guard also covers element presses.
- Keyboard targeting never raises a window over an untitled helper window, such as Finder's rename editor.
- The accessibility typing route is used only for text-entry fields.

Harness fixes found on the console:

- `safari-link` compares the page's report without its #hash.
- The Safari oracles look for this attempt's unique URL in any document, not just the front one.
- Click steps match element values as well as labels.
- A refusal because the window changed is retried after re-observing.
- Fixture `open` retries LaunchServices error -600 while an app is still quitting.

## Results: 2026-09-24, apple-cua, off-console session

Measured in a session that did not own the physical console (Screen Sharing into `bob` while another user's console session was locked), with background delivery, the default. Run 1 is the first baseline and run 3 the midpoint, both from earlier the same day. Run 11 is the latest code, stored as `.sisyphus/evidence/bench-v2/2026-09-24-run11-apple-offconsole.json`.

| Metric (105 attempts) | Run 1 | Run 3 | Run 11 |
| --- | --- | --- | --- |
| Pass | 27 | 72 | **85** |
| p50 / p95 call ms | 5185 / n/a | 5229 / 5630 | **381 / 741** |
| Calls per task | 2.8 | 5.9 | 6.1 |
| Estimated tokens per task | 1659 | 3365 | 3347 |
| Focus changed / pointer moved | 1 / 5 | 5 / 1 | **0 / 0** |
| Attempts with cleanup leftovers | 20 | 42 | 3 |

In run 11, 17 of the 21 scenarios pass 5/5. The four that fail need input that this kind of session does not deliver without taking focus or moving the pointer:

- Safari page content (`safari-form`, `safari-link`, `clipboard-cross-app`) is not reachable by keyboard or accessibility off-console.
- The Save panel (`textedit-save-sheet`) ignores background keys off-console.

Those 20 attempts are the off-console ceiling under the "stay background" rule; they need an on-console run. The 3 leftovers are Safari tab checks, because Safari's AppleScript does not answer off-console. The 5 forced cleanups are TextEdit quits after the stuck Save panel, and each one is disclosed in `cleanup.forced`.

Driver changes behind these numbers:

- Keyboard input is aimed at the observed window. apple-cua raises it inside its app with AXRaise, or off-console selects it from the app's Window menu. It never raises over a sheet or dialog.
- Background delivery sends a self-activating target app (Finder's Go to Folder) back behind the user's app.
- Element clicks tolerate a window that moved since observation.
- The app list no longer goes stale after an app relaunches.

Harness fixes:

- `finder-selected` now compares real paths. It could never pass before, because `/tmp` resolves to `/private/tmp`.
- Oracles wait a bounded time for asynchronous saves.
- Off-console, checks use OCR of a window matched by title instead of AppleScript.
- TextEdit auto-capitalization, spelling correction and state restoration are scoped off for the run and restored afterwards.
- Stuck Finder alerts and windows that close late are cleaned up.
- A signal stops the run after the current attempt and restores the clipboard and preferences.
