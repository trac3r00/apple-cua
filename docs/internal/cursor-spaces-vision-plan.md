# Cursor, Spaces, and visual element understanding

## Users and ideal state

The primary user keeps working on their Mac while an agent operates an approved
application. The agent developer consumes observations and must distinguish a
supported action from a model inference or an unverified dispatch.

1. The agent cursor is visibly smaller: use a 24-point theme canvas instead of
   42 points, retaining the exact target hotspot and noninteractive overlay.
2. Attended keyboard input shows a keyboard symbol, including keyboard-only
   sessions. Pointer, scroll, click, and thinking feedback remain distinct.
   The coordinated-cursor policy merged from main keeps all background delivery
   visually silent, including keyboard input.
3. A background observation and action can address an explicitly observed window
   in another Mission Control Space without foregrounding or raising the app,
   switching Spaces, or moving the real pointer. Current-Space AppKit activation
   is distinct from foregrounding; the off-Space path intentionally skips
   activation. Attended input retains its current-Space restrictions. Closed,
   minimized, and ambiguous windows must not silently become another target.
4. The connected agent's vision model inspects the entire approved window from
   top to bottom, including icon-only controls, text, toolbars, sidebars, content,
   sheets, and bottom controls. It returns bounded visual regions in screenshot
   coordinates, distinguishes likely controls from static text, and reports
   uncertainty. Visual regions are not fabricated accessibility element IDs.
   Existing observation tokens and coordinate guards still govern actions.

The approved application window is the visual analysis boundary: this does not
grant observation of other applications merely because they share the display.
Other windows can be observed individually by their window IDs.

## Evidence and gaps before implementation

- `packages/core/native/cursor-overlay.m`: 42-point theme artwork; pointer,
  scroll, thinking, and transient click modes; no keyboard mode.
- `packages/core/src/platform/macos-input.ts`: keyboard paths reassert the
  cursor without identifying keyboard activity. Semantic keyboard paths in
  `macos.ts` also need feedback.
- `macos-open-windows.ts` enumerates current-Space windows even though
  `macos-ffi/window-list.ts` already supports `onScreenOnly: false`.
- `macos-window-target.ts` rejects off-Space windows unconditionally.
- Observation, preflight, and input must use the same selection policy.
- `macos.ts` already captures individual windows and exposes nested AX controls.
  Apple Vision OCR is text recognition, not general clickable control detection.
- The user selected the connected agent's model through MCP sampling for visual
  analysis. No new paid endpoint or model credentials are assumed.

Primary documentation:

- Apple ScreenCaptureKit `SCShareableContent` and desktop-independent window
  filters support selecting capture content; capture success still needs proof.
- Apple `CGEventPostToPid` addresses a process, not a universal guarantee that
  every application accepts every event on another Space.
- Apple `VNRecognizeTextRequest` recognizes text, not clickability.
- MCP sampling supports image messages and client-owned model access; inspect
  the installed SDK contract rather than assuming the latest SDK API.

## Execution checklist and write scopes

Use independent workers, not a team: file scopes can be separated. No commits
are authorized. Keep this existing worktree and preserve unrelated edits.

### Foundation workflow

- [x] Native overlay: smaller artwork and a keyboard symbol; extend the existing
  mode protocol in `cursor-overlay.ts` and its serialization test.
- [x] Window policy: background-only all-Spaces enumeration and explicit target
  resolution, with unit tests. Preserve attended and ambiguous-target behavior.
- [x] Visual analysis helper: bounded structured model output, screenshot
  coordinates, complete top-to-bottom coverage, deterministic reading order,
  malformed/out-of-bounds rejection, uncertainty, no synthetic AX IDs.
- [x] Verification node: run targeted tests and report exact failures.

### Integration workflow

- [x] Wire background enumeration/resolution through observation, preflight, and
  input. Avoid activation/raise routes for off-Space targets. Wire keyboard mode
  through actual keyboard paths and semantic AX/menu routes.
- [x] Add opt-in `analyze_screen` using the connected client's image sampling.
  Preserve the guarded observation/token contract. Clearly report clients
  without sampling or screenshots, and propagate model failures honestly.
- [x] Update usage documentation and tool inventory tests where required.
- [x] Verification node: run targeted integration tests and type diagnostics.

## QA scenarios and binary acceptance

- [x] Build native code successfully. Capture the real overlay in pointer,
  keyboard, scroll, thinking, and click states. Verify smaller artwork, visible
  keyboard glyph, no clipping, unchanged hotspot, and no real pointer movement.
- [x] Keyboard tests verify attended feedback for typing, key chords, and semantic
  text replacement; background paste stays visually silent without depending on
  wall-clock luck.
- [x] Background target tests include a window absent from the onscreen list;
  attended mode still refuses it. Missing/closed/wrong-PID/ambiguous targets
  refuse rather than retarget. Observation and preflight use the same policy.
- [x] Live cross-Space QA: capture an existing off-Space test window, mutate a
  task-owned fixture, read back the change, and compare frontmost app, active
  Space, and real cursor before/after. Include full-screen Space where available.
  A fixture or permission unavailable on this host is unverified, not passed.
- [x] Visual helper tests cover controls at the top, middle, and bottom,
  icon-only controls, static text, overlapping regions, uncertainty, malformed
  JSON, nonfinite/out-of-image boxes, excessive output, and reading order.
- [x] MCP protocol QA uses an image-capable sampling client and a real fixture
  screenshot. Assert image delivery, bounded parsed output, original observation
  token behavior, no invented AX IDs, and honest unsupported-client behavior.
- [x] Live vision QA compares inferred controls against the entire fixture,
  including icon-only and bottom controls. A fake sampler proves wiring only.
- [x] Run repository lint, production and test typechecks, tests, and build.
  Report pre-existing failures separately. Clean task-owned scratch processes,
  sockets, screenshots, and fixtures; retain only named evidence deliverables.

## Completion

Every checked item needs captured evidence from this run. Tests alone do not
prove cross-Space behavior or model accuracy. Do not claim universal clickable
element completeness, universal application event delivery, or a successful
action merely because a model or API said so. Record unresolved gaps explicitly.

## Evidence ledger

Evidence paths under `.omo/evidence/cursor-spaces-vision/` below refer to
local ignored run artifacts; those files are not included in this checkout.
Reproducible repository checks include
`pnpm exec vitest run packages/mcp/src/visual-tools.protocol.test.ts packages/mcp/src/visual-analysis.test.ts`,
`pnpm typecheck:tests`, `pnpm lint`, and `pnpm build`. These commands establish
repository test/build behavior only; they do not reproduce live desktop or
connected-model evidence.

- Foundation worker verification: 41 tests passed in four targeted test files.
  Standalone MCP typecheck could not resolve the unbuilt core workspace package;
  integration verification must build core TypeScript first.
- Real native fixture: window 1766, PID 43591, bundle
  `dev.apple-cua.task-owned-qa`. Initial capture contains top and bottom buttons,
  an editable middle field, an icon-only star button, and static text.
- Moved only this fixture window from Space 3 to Space 4. WindowServer confirms
  it is absent from the onscreen list and present in the all-windows list.
  Active Space and front-process identity remained unchanged across the move.
  Before integration, explicit off-Space observation reproduced
  `No visible target window available for pid 43591`.
- Captured changed native pointer and keyboard modes at
  `.omo/evidence/cursor-spaces-vision/overlay-pointer.png` and
  `overlay-keyboard.png`. Both are compact and unclipped; keyboard keys are
  visually recognizable. These prove rendering, not input-to-mode wiring.
- The persistent evaluation process cached NSWorkspace's application inventory
  before fixture launch. QA uses direct NSRunningApplication lookup of the known
  fixture PID for that inventory seam; pixels, AX, input, and Space state remain
  real. No host app-approval configuration was changed.
- Independent rerun: foundation tests pass (40 tests); minimized-window and
  neighboring AX snapshot tests pass (42 tests).
- Native window capture of replacement fixture PID 56699, window 1835, on Space
  4 returned a real 640 by 752 JPEG (25,100 bytes) while the active Space stayed
  3, the front process stayed `0000000077700700`, and the real cursor stayed
  `(78,216)` across the capture.
- Visual review found the original keyboard badge overlapped the arrow and the
  blue fill alone had weak contrast on white. The final badge is smaller and
  separated to the right; a dark contour preserves the blue fill while making
  the pointer boundary visible on light backgrounds. Final captures of all five
  modes were inspected over white, gray, and dark backgrounds. The measured
  strongest pointer boundary against white is 8.52:1; transparent margins remain
  on every edge. Thinking animation retains its existing fade; a single frame
  is not a timing or full-animation proof.
- The task-owned live MCP harness is
  `.omo/evidence/cursor-spaces-vision/live-qa.mjs`. It will request image sampling
  through a real connected client, consume that exact response, click the
  visually identified bottom control through the guarded coordinate route,
  verify the actual fixture changed, reject token replay, and verify background
  keyboard input without a Space/focus/pointer change during either dispatch.
- Live QA exposed an AppKit distinction missed by the first unit tests:
  `AXWindows` and application children can be empty on another Space while
  `AXFocusedWindow` still exposes the exact window and all its controls. The
  minimized-state query and scoped AX walk now use that reference only when its
  WindowServer ID matches. Regression tests prove both successful traversal and
  rejection of a different focused-window ID. Those focused suites pass 60 tests.
- A real MCP `analyze_screen` call captured the off-Space fixture, produced a
  guarded token and full AX controls, and sent its exact image to the connected
  client sampler. The connected model returned ten bounded regions, including
  the icon-only star, editable field, and bottom button. The image and verbatim
  response are retained as `sampling-image.jpg` and `model-response.json`.
  Some titlebar estimates are imprecise, so model-reported coverage is explicitly
  an unverified inference; AX elements and the image remain available for
  grounding. This is not proof that every inferred control is actionable.
- The first live callback timed out after a long JSON response was submitted
  over a canonical PTY; input buffering was the suspected transport problem.
  The task-owned QA client now uses raw input.
  Before the corrected run could dispatch input, the person locked the Mac.
  The backend correctly refused observation and dispatched nothing. An unlock
  subscription and user question are active; real click, key effect, and token
  replay checks remain pending, not passed.
- Independent full-suite verification found and fixed a stale keyboard mock,
  a changed error assertion, a native-window fixture leak in a preflight reason,
  and the lean tool-list byte budget. The budget remains 12,000 bytes; the
  observation description was compacted instead of raising the limit.
  A control-character PNG test header is now escaped explicitly to prevent the
  editor formatter corrupting it. The five affected suites pass 90 tests.
- A final production-path review found that the native MCP window probe still
  defaulted to current-Space enumeration. It now defaults to all Spaces for
  background delivery, preserves attended behavior and explicit caller scope,
  and has three regression cases. The live harness now uses that production
  factory instead of a custom all-Spaces probe.
- Final static gate: repository lint, production and test typechecks, and
  `git diff --check` pass. Vitest passes 1,529 tests in 172 files; two existing
  opt-in live tests remain skipped. Script tests and all workspace builds pass.
  No real click/key success is claimed while the Mac remains locked.
- Final unlocked live run (`bash_66`, exit 0): the real connected MCP sampling
  client supplied the complete fixture image for inspection. The response
  identified 11 regions, including all three titlebar controls, the title, top
  button, middle label and editable field, icon-only star, status, and bottom
  button. This is a fixture comparison, not a guarantee of exhaustive recognition
  on arbitrary applications. Completeness remains explicitly unverified in the
  protocol result.
- A guarded click at the visually inferred bottom-button center changed the
  actual fixture status to `Pressed: bottom`. Reusing the observation token was
  refused. A fresh observation then authorized `k`, and real field readback
  changed from `Initial QA text` to `k`. The actual keyboard route requested
  keyboard overlay mode.
- Each dispatch separately asserted unchanged active Space, front process, and
  physical cursor. The whole run stayed on Space 117 with front process
  `0000000077700700`. The cursor changed during the human sampling round trip,
  so its overall baseline/final positions are not evidence of immobility;
  only the immediate per-dispatch assertions prove that property.
- Read-only Space inventory after this run found IDs 3, 4, 5, 6, and 117, all
  type 0 (normal desktop Spaces). No full-screen Space was available. No user
  Space was created or switched, and a target inside a full-screen Space remains
  unverified on this host.
- Exact image bytes, sampled response, successful harness output, assertions,
  and Space inventory are retained in
  `.omo/evidence/cursor-spaces-vision/live-verification.json`.
- Cleanup: fixture process `bash_51` exited 0 after `quit`; its task-owned compiled
  `Fixture.app` was removed and absence verified. Sampling harnesses have exited,
  and both unlock watches completed. The native overlays were already stopped.
  Retained evidence and reproducible fixture/harness source live only under the
  named `.omo/evidence/cursor-spaces-vision/` project directory.
- Publication integration: merged concurrent main commit `aa6fe95`, preserving
  worker cursor identities, vision grounding, and visually silent background
  delivery. The smaller native cursor and keyboard badge remain attended-mode
  indicators. Integrated repository checks pass 1,565 tests with two opt-in skips,
  strict typechecks, lint, script tests, and all builds. A fresh real off-Space
  fixture run verifies actual bottom-button and keyboard effects, one-use tokens,
  silent background overlays, and immediate Space/front-app/cursor invariants.
  Its local ignored artifact is
  `.omo/evidence/cursor-spaces-vision-review/merged-main-verification.json`.
