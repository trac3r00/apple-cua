# Audit disposition (2026-11-07)

An external audit of the repository proposed fixes and a roadmap. Each claim was checked against origin/main
(a4d446b) before any change. This file records what was fixed, what was rejected and why, and what stays open.

Product rule that decided every item: opencua never uses the person's mouse, screen, peripherals or Spaces. It acts
through virtual cursors on windows it owns (owned surfaces) and in isolated sessions.

## Fixed

| Audit item | Verdict on main | Change | Evidence |
| --- | --- | --- | --- |
| `opencua-surface` missing from `@opencua/core` `files` | True | `native/opencua-surface` and its source ship in the package | `npm pack --dry-run --json` lists both |
| Browser native host registered for Brave only (`packages/browser/src/service.ts`) | True | Manifest goes to every installed Chromium browser (Chrome, Chrome Beta, Chrome Canary, Chromium, Brave, Edge, Arc, Vivaldi); Brave stays the fallback; uninstall and doctor cover all | `service.test.ts` |
| 31 hand-written `.js` bridges in `packages/cli/src` | True | `source-bridges.test.ts` fails when a bridge is missing or points at a missing `.ts` | Test fails with `utm.js` removed |
| One global window-capture gate in `sckit.m` | True | The gate is per window id and the capture queue is concurrent: different windows capture at the same time, and a second capture of a window already being captured is refused (the caller retries) | Live: two owned-surface windows captured concurrently (main refused the second) |
| `spacesForWindows` stub in `sls-spaces.ts` | True | Real `SLSCopySpacesForWindows` binding, one window per call, mask 7, SInt32 CFNumber; the answer is read as a flat list of space ids | Child-process probe ran with no crash; a regular window mapped to space 367, which `managedDisplaySpaces` lists |
| Fixed 4 ms keystroke interval | True | Opt-in `OPENCUA_TYPE_RHYTHM=human`: 60 ms typist base, longer pauses after word boundaries and newlines, faster repeats and same-hand pairs, jitter; default unchanged | `typing-rhythm.test.ts` |
| Smoothstep-only drag profile | True | Opt-in `OPENCUA_DRAG_PROFILE=lognormal` sigma-lognormal profile (velocity peak at t of about 0.21); default unchanged | `drag-profile.test.ts`; live strokes on an owned surface |
| One worker per app, no sharing inside a window | Partly true: owned surfaces already allowed several workers | Optional per-worker `region` on `manage_workers` for shared surfaces. Overlapping regions are refused. A `run_worker` pointer target or element edit outside the region is refused before any input | `worker-regions.protocol.test.ts`; live run with 3 named cursors in one window |
| No prompt-injection signal on observed text | True | `untrusted_content_warning` lists the matched patterns and element ids; observed text is unchanged | `untrusted-content.protocol.test.ts` |
| No hearing ("ears") | True | Owned surfaces report `audio: {playing, changedAt}` from WebKit's playing-audio state, and `get_app_state` carries it | Live: tone page reports playing, silent page does not |

## Rejected

| Audit item | Why |
| --- | --- |
| Remove `denyHostInteraction` and turn host app control back on (`host-interaction-policy.ts`, `macos.ts` capabilities, `skylight.ts`, `accessibility.ts`) | It is the isolation the person asked for on 2026-10-30 and confirmed on 2026-11-07. The audit read it as a regression. |
| Default `inputAllowed: true` in `GuardedPlatformComputer` (`native-policy.ts`) | Same rule. Linux and Windows host input stays refused until those backends run in an isolated session. |
| Overlay keyed by `cursor_id` in `cursor-overlay.m` | The host overlay is refused by policy. Several named cursors in one window already exist on owned surfaces, and per-worker regions now apply to them. |
| Audio level capture through ScreenCaptureKit for owned surfaces | Tried and measured: WebKit plays page audio in `com.apple.WebKit.GPU`, which ScreenCaptureKit does not list as an application, so an app filter on the surface hears silence. The playing state above is what can be attributed reliably. |

## Open

- Concurrent strokes on a shared surface: the first cursor's drag kept its waypoint, while the cursors that waited drew
  straight from their start point to their end point. This was seen live with and without the lognormal profile. The
  paced surface input from #43 is the likely place to look. A branch already works on that area, so it is left to that branch.
- Region checks read an element's frame right before its step is dispatched, and the step driver reads it again when
  it posts. A control that moves between those two reads can still be clicked just outside the region. Closing this
  needs the driver to accept the checked frame.
- Regions confine pointer targets and element edits only. A target search can scroll the shared window, keyboard steps
  type wherever focus is, and an element-less scroll is not checked, so these can still change content in another
  worker's region. A refusal after such a search reports that nothing was sent.
- `screenshot.ts` keeps its own typed CoreFoundation bindings, including an Int32 CFNumber helper that duplicates
  `toCFInt32Number`. Unifying them is a separate refactor of those bindings.
- The surface socket path must fit `sun_path` (104 bytes). A long `OPENCUA_STATE_DIR` makes the surface run without a
  socket, and `sendSurfacePointer` then returns false.
- Not started: a persistent `SCStream` per window with a ring buffer, local UI detection models, speculative multi-step
  execution, self-healing element anchors, per-agent pasteboards, one-shot demonstration compilation, virtual
  displays, and native Windows and Linux daemons. Each needs its own design and measurement before code.
