# Native background input QA

The manual fixture is a task-owned AppKit app, not a third-party drawing or 3D
integration. It publishes actual canvas state through accessibility and logs
native events. No fixture input is simulated internally.

Build and launch behind the human's app:

```sh
mkdir -p /tmp/apple-cua-background-qa.app/Contents/MacOS
cp scripts/fixtures/Info.plist /tmp/apple-cua-background-qa.app/Contents/Info.plist
swiftc -framework AppKit scripts/fixtures/background-input.swift \
  -o /tmp/apple-cua-background-qa.app/Contents/MacOS/background-input
codesign --force --sign - /tmp/apple-cua-background-qa.app
open -g -n --stdout /tmp/apple-cua-fixture-focus.jsonl \
  --stderr /tmp/apple-cua-fixture-errors.log /tmp/apple-cua-background-qa.app
```

Use the signed runtime already granted Accessibility and Screen Recording:

```sh
packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp \
  scripts/verify-native-fixture.mjs
```

The verifier checks actual stroke, rectangle, orbit projection and text outcomes,
plus before/after foreground PID, hardware pointer and unchanged window bounds.
Inspect the fixture's `foregroundChanged` notifications during the run separately;
before/after equality alone does not rule out transient focus theft.
Geometry checks use the exact AX window frame. WindowServer can add or remove
a one-point inactive decoration around an unchanged AppKit window, so its
compositing footprint alone is not evidence that the window moved.
For task-owned runs, set `APPLE_CUA_FIXTURE_TITLE`,
`APPLE_CUA_FIXTURE_FIRST_LOG`, and `APPLE_CUA_FIXTURE_SECOND_LOG` to unique
values. `APPLE_CUA_FIXTURE_SCREENSHOT` optionally retains a JPEG of the exact
fixture window through the existing native-capture/CLI-fallback path.

For independent native input lanes, launch a second process:

```sh
open -g -n --stdout /tmp/apple-cua-fixture-second.jsonl \
  --stderr /tmp/apple-cua-fixture-second-errors.log /tmp/apple-cua-background-qa.app
packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp \
  scripts/verify-native-parallel.mjs
```

Run parallel QA with these two fresh processes. The verifier associates the newest
window with the second log and the next window with the first log, subscribes
before dispatch, and waits for each native mouseUp with a bounded timeout. It
checks overlapping gesture intervals, distinct resulting strokes, unchanged
foreground/pointer, and both window frames. It exits nonzero if an AX window is
unavailable; it does not activate or relocate a window to bypass that failure.

## Captured results

On 2026-10-09, native stroke/shape/orbit/text QA passed. Option was present on
every orbit mouse event through mouseUp, followed by modifier release.
`/tmp/apple-cua-native-fixture.png` was inspected: blue multisegment stroke,
orange rectangle, rotated purple cube, text `native QA`, inactive title bar.
Native foreground subscriptions reported no foreground changes during the run.

Two independent processes passed concurrent input QA: intervals
607.28–1135.69 ms and 622.97–1159.21 ms overlapped and produced different strokes.
Foreground PID 65822, hardware pointer `(401.625,1134.875)` and window frames
were unchanged. The native hardware cursor remains singular.

`scripts/verify-native-cancellation.mjs` passed against the newest fixture using
the second log: it subscribes before dispatch, requests interruption after the
first native drag event, observes `InputInterrupted`, and verifies a right-button
mouseUp at `(500,200)` before the intended `(700,300)` endpoint. The native canvas
reported `dragging:false`. Native logs also record modifier release.

Only one physical display was connected. Negative-origin and spanning-window
regressions cover coordinate contracts but do not prove physical multi-screen QA.
These results do not establish arbitrary third-party 3D support, tablet pressure,
multi-touch or successful hover tooltips in apps that reject background hover.

## Real-app follow-up

The user requested Freeform and Keynote acceptance on the real apps. Guarded
observations initially reached Freeform `Untitled 2` (window 17244) and the
task-created Keynote `Untitled` (window 17182), both nonfrontmost.
Keynote's observed Text button inserted a new box; background typing produced
visible `apple-cua real-app QA` in that box. The window bounds remained
`(146,164,2318,1150)` in both mutation results.
The subsequent explicit verification failed with `No visible target window`;
fresh explicit-ID observations of both apps also failed despite an unlocked
console and granted permissions. Therefore this is visible partial progress,
not final passing real-app acceptance. Freeform's New Board action reported
`suspected_noop`, and verification confirmed no `Untitled 3` window.
No existing board was edited. Hidden-window discovery is being diagnosed before
any further input, rather than foregrounding or moving the windows.

A fresh task-owned current-build guarded MCP server subsequently observed and
verified both exact window IDs successfully without activation. Runtime diagnosis
reports that the long-lived MCP server also resolves the developer checkout and
contains the all-window fallback; stale installation is therefore not established
as the cause. Fresh server success indicates a lifecycle/state difference still
requiring diagnosis, not proof that setup/reinstallation fixes the issue.

Freeform's observed File > New Board in New Window route created `Untitled 3`,
window 29311, at `(0,31,660,725)`. A fresh matching AX root was confirmed before
editing; earlier mismatched AX results were not used for input. The toolbar text
tool and background typing produced visible `Apple-cua Freeform QA` (Freeform
capitalized the initial letter). `/tmp/apple-cua-freeform-text.png` was inspected
and guarded `verify_state` confirmed `Untitled 3` is open. Both mutations reported
nonfrontmost and unchanged bounds. Keynote inserted a line from its Shape picker;
`/tmp/apple-cua-keynote-shape.png` shows that line and the earlier QA text.
Subsequent AX availability remains intermittent; a stale Freeform toolbar action
was safely refused without a continuation token. Shape/drawing/drag acceptance
and independent physical focus/pointer checks remain open.

Further Freeform real-app QA inserted the named Circle through its observed shape
menu and moved it with a 500ms background drag. Lead inspected
`/tmp/apple-cua-freeform-circle.png` and `/tmp/apple-cua-freeform-drag.png`: the
150px blue circle moved from screenshot center `(330,384)` to `(170,210)`;
board frame `(0,31,660,725)` remained unchanged and guarded verification passed.
The earlier pen waypoint gesture produced a visible line but did not establish
the intended multisegment curve. Independent before/after oracle around that
gesture matched foreground PID 65822 and hardware pointer
`(659.75,732.98046875)`. This is bounded before/after evidence, not a transient
foreground guarantee for every later operation.

Real-app QA discovered an unsafe explicit-window AX fallback: a new window image
could be paired with another window's controls. The fallback now fails closed
when the requested window has no matching AX root. Independent verification:
36 AX tests and rebuild passed; scoped formatting/core types plus AX/pointer
regressions passed 46 tests. Global `pnpm check` still stops on concurrent browser
formatting; owned bridge formatting was corrected separately. Keynote currently
provides an image but no AX roots, so further element actions are not sent.

Freeform pen-curve acceptance subsequently passed with its actual pen-tool
interaction: click start, drag a point to form curve handles, click endpoint,
Return. `/tmp/apple-cua-freeform-curve.png` visibly shows a black curved path with
three control points, alongside the moved blue circle. Guarded verification
confirmed `Untitled 3`; all four steps used synthetic background delivery and
the app remained nonfrontmost. This demonstrates a real app curve workflow, not
a guarantee that every pen tool consumes a held freehand waypoint path.
Keynote remains image-only with no matching AX root after the safety fix; a
nonblocking question asks whether its scratch window is minimized/on another
Space to distinguish native window state from a publication defect.

The user confirmed Keynote is on another Space/minimized. Background exact-window
drag moved the task-inserted line from the title region into the lower slide area;
`/tmp/apple-cua-keynote-drag.png` was inspected and compared with
`/tmp/apple-cua-keynote-current.png`. The window frame remained
`(146,164,2318,1150)` and foreground PID remained 3607. Hardware pointer samples
changed `(105.875,1005.98046875)` to `(396.375,941.23046875)` between separate
oracle processes during active human use; this does not prove pointer theft or
preservation. Keynote's final guarded title verification returned false because
AX window titles were unavailable. Visual drag success is therefore recorded
separately from the unmet strict AX-verification requirement.

Current integrated regression after the exact-window AX fix: 1415 Vitest tests
passed, two live tests skipped; 21 script tests passed; build exited 0. The
remaining Keynote title-verification gap is being addressed only with a fresh
native title for the exact resolved window, without inventing AX controls or
treating a title match as action-effect proof.

Independent review found that the first proposed title regression covered a
visible attended window, not the reported hidden background case. The producer
was corrected to test an explicit target excluded from on-screen inventory and
to use only the fresh exact WindowServer lookup as native-title fallback. No
MCP title contract expansion is needed; full action verification remains distinct.

Corrected exact-hidden-title regression independently passed 39 tests and core
rebuild; scoped Biome passed after formatting correction. Real current-build
guarded Keynote observation reports `axAvailable:false`, native title `Untitled`,
and final `verify_state(window_title)` now passes without restoring the window.
Text, inserted line and moved-line outcomes remain supported by the inspected
screenshots, not by the title check alone. Native enumeration confirmed current
Freeform window IDs 17244 and 29311 both report title `Untitled 3`; that surprising
title is native app state, not inferred from a different AX root.

A same-process signed measurement around another Keynote background line drag
matched foreground PID 65822 and physical cursor `(826.875,969.23046875)` before
and after. The exact window frame remained `(146,164,2318,1150)`.
`/tmp/apple-cua-keynote-measured.png` confirms the line moved a further 100px
right; fresh observation and guarded title verification passed afterwards.
The mutation itself remained `unverifiable`/paused because hidden AX controls
were absent; fresh capture plus independent visual comparison supplied the
effect evidence, not a replay or a title-only effect claim.
Final full suite after the title fix: 1416 tests pass, two opt-in live tests
skipped, 21 script tests pass, build exit 0.
