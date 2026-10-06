# Complex background scenarios: apple-cua vs OmO's `computer` tool

Measured 2026-10-05 on an Apple M4, console session, both drivers in background delivery on the same Mac. Harness:
`.omo/plans/cx/` (local, git-ignored): `fixtures.mjs` (setup, oracle, cleanup per scenario), `sampler.mjs` (an
independent process logging every real-cursor move and front-process change at 5 ms), `run-apple.mjs` (apple-cua over
MCP through the signed helper) and `omo-scenarios.json` (the OmO `computer.run` scripts).

## Scenarios

Every scenario is judged by an external oracle (file on disk, Finder's own selection, Calculator's display), never by
the driver's own report.

| # | Scenario | Oracle |
|---|---|---|
| s1 | Finder, 152-row list view: select `zz-test1.txt` (below the fold), Cmd-click `zz-test2.txt` | exactly those two rows selected |
| s2 | TextEdit `note.txt`: replace `beta` with `BETA ✓`, append `added 한글 line`, save | file content on disk |
| s3 | Calculator: (12 x 12) + (7 x 8) - 5 | display reads 195 |
| s4 | Cross-app: 23 x 17 in Calculator, append the result to TextEdit `result.txt`, save | file reads `Result: 391` |
| s5 | Two TextEdit windows: edit and save `b.txt` only | `b.txt` changed on disk, `a.txt` untouched and not dirty |
| s6 | Finder: File > New Folder in a second window, name it `cx-folder` | folder exists, no `untitled folder` |

Rules: each driver uses its documented best route. apple-cua runs in background delivery (it refuses rather than
taking the foreground). OmO tries background first and, when it throws BackgroundUnavailable, retries once with
`delivery: "foreground"` as its documentation prescribes. n = 3 per scenario per driver; driver-level scripts, no model
in the loop.

## Baseline (before fixes)

| # | apple-cua pass | apple-cua median | OmO pass | OmO median | Disturbance (cursor moves / front changes) |
|---|---|---|---|---|---|
| s1 | 0/3 | 2.7 s | 0/3 | 7.5 s | apple 0/0, OmO 0/0 |
| s2 | 0/3 | 0.4 s | 0/3 | 0.1 s | 0/0, 0/0 |
| s3 | 3/3 | 0.6 s | 3/3 | 1.4 s | 0/0, 0/0 |
| s4 | 0/3 | 1.0 s | 0/3 | 1.3 s | 0/0, 0/0 |
| s5 | 0/3 | - | 1/3 | 2.8 s | 0/0, 0/2 |
| s6 | 0/3 | 0.3 s | 0/3 | 11.5 s | 0/0, 0/18 |
| total | 3/18 | | 4/18 | | apple-cua 0 / 0, OmO 0 / 20 |

Why each failed:
- apple-cua s1: a background Finder swallows a plain pointer click as the window-activating first click
  (`suspected_noop`); only the Cmd-click, which already told the app it was active, landed.
- apple-cua s2, s4, s6: macOS disables window commands (Save, New Folder) while the app is inactive, and apple-cua
  refused instead of finding another route.
- apple-cua s5: `list_windows` returned empty titles (window names need Screen Recording, which the helper lacks), so
  the agent could not tell `a.txt` from `b.txt`; `run_script` could not bind to a window either.
- OmO s1: its plain click selected `zz-test1.txt`, but the background Cmd-click on `zz-test2.txt` did not add to the
  selection.
- OmO s2, s4: a background Cmd+S to TextEdit returned without error but did not save (it saved once in a separate
  smoke run).
- OmO s5, s6: background keys to a multi-window app throw BackgroundUnavailable; the foreground retry either never got
  the key window ("did not become the key window ... nothing was posted") or created `untitled folder` without the name
  landing, and moved the front app 20 times. After the runs the person's front app was left on TextEdit instead of
  Terminal.

## After apple-cua fixes (same build and harness for both drivers)

| # | apple-cua pass | apple-cua median | OmO pass | OmO median | Disturbance apple-cua / OmO (cursor, front) |
|---|---|---|---|---|---|
| s1 | 3/3 | 2.9 s | 0/3 | 8.4 s | 0, 0 / 0, 0 |
| s2 | 3/3 | 0.8 s | 0/3 | 0.4 s | 0, 0 / 0, 0 |
| s3 | 3/3 | 0.6 s | 3/3 | 2.0 s | 0, 0 / 0, 0 |
| s4 | 3/3 | 1.3 s | 0/3 | 1.6 s | 0, 0 / 0, 0 |
| s5 | 3/3 | 0.9 s | 1/3 | 3.2 s | 0, 0 / 0, 2 |
| s6 | 3/3 | 1.3 s | 0/3 | 11.5 s | 0, 0 / 0, 18 |
| total | 18/18 | | 4/18 | | apple-cua 0, 0 / OmO 0, 20 |

The fix worker had already recorded three consecutive 18/18 runs (54/54) before this independent run; with this one,
apple-cua passed 72 of 72 trials on the final build with no real-cursor move and no front-app change inside any run.
Every apple-cua scenario took one tool call. OmO again left the person's front app on TextEdit after its foreground
retries (it was restored to Terminal afterwards).

What changed in apple-cua:
- Background pointer clicks, double clicks and drags first tell the target app it is active for that window (without
  changing the front process) and send that window a primer click at a point inside no display and no on-screen
  window ((-1, -1) unless a display arranged above or left of the main one, or a window, covers it; skipped and
  logged when the layout cannot be read), so first-mouse-refusing apps such as Finder act on the click. The hold is per app, extended by later input, and released after 2 s idle or when the
  server exits.
- Window commands (Save, New Folder) for an app behind the person's go through one route for `invoke_menu`,
  `run_steps`, `run_script` `app.menu` and Command shortcuts: raise the observed window inside its app, activate the
  app without bringing it forward, wait up to 1.5 s for the item to enable under its refreshed title, press it;
  still-disabled items are refused with nothing sent.
- Window titles come from accessibility when the window server hides them (no Screen Recording): `list_windows`,
  title checks, `get_app_state` candidates, new-window events.
- `run_script` binds to a window: `apple.app(name, { window: title | id })`, `apple.windows(app?)`; ambiguous or
  missing windows are refused before anything is sent, and menus and saves act on the bound window.
- A standalone `app.waitFor` that succeeded was wrongly reported as refused; fixed.

Known side effect: when the activation hold is released, TextEdit autosaves any other unsaved document of the same
app. An agent that edits two documents and saves one will see the other autosaved about 2 s later.

Why it stays (probed 2026-10-05, background only, TextEdit with `a.txt` edited through accessibility and left
unsaved, `b.txt` the activated window, `a.txt` on disk sampled every 100 ms):

| Probe | `a.txt` on disk | TextEdit AXFrontmost |
|---|---|---|
| no activation, 8 s | untouched, still modified | false |
| activated for `b.txt` and held with no release (8 s; in another run 25 s) | untouched while held | true the whole time |
| released after 1.5 s, 8 s or 25 s | written within ~120 ms of the release, no longer modified | false after release |
| released naming `a.txt`'s window instead | written within ~110 ms | false |
| deactivation sent with no activation before it | written within ~110 ms | false |

So the trigger is the deactivation event itself, not the 2 s idle, the activation or the window it names. AppKit
explains it: `-[NSApplication _handleDeactivateEvent:]` posts `NSApplicationWillResignActiveNotification` before
anything else, with no check that the app was active, and `-[NSDocumentController _appWillBecomeInactive:]` then calls
`autosaveWithImplicitCancellability:completionHandler:` on every document whose class autosaves in place. That is the
same event a person's switch away from TextEdit delivers. Every way to end the hold is that event, and without it the
app keeps reporting itself frontmost behind the person's app (NSRunningApplication `isActive` stays false throughout,
since the front process never changes), so the release is kept as it is, and `APPLE_CUA_BACKGROUND_ACTIVATION=off`
turns background activation off: no hold, no primer, no release and no autosave, at the price of background clicks
that first-mouse apps spend on activating a window and window commands refused while the app is inactive.

Cursor moves seen in two early worker runs (1 and 17 samples) were traced to the person's own mouse: every sample
fell after the script returned, none lay inside a target window, and s3 sends no pointer events (accessibility
presses only); isolated re-runs logged zero events.
