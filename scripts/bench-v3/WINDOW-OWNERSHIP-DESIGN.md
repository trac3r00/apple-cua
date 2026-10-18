# Exact-window keyboard ownership: design assessment

Advisory document for the remaining bench-v3 ownership gate (two-app fixtures beside
personal windows; LEDGER.md "Two-app ownership track", COVERAGE.md `two-apps-one-task`).
Nothing was run, built or operated for this document. Line numbers are those of the
working tree read on 2026-10-11 (HEAD `e62e06f`; `packages/core/src/platform` carries
uncommitted changes, and the focus guard quoted below is among them: `git show
HEAD:packages/core/src/platform/macos-input.ts` contains no "verified focused window").
Unit tests and comments are cited as statements of intent, never as live proof.

## 1. Question and verdict

Question: after the explicit-bound guard verifies that the observed window is the app's
focused window, does keyboard dispatch deliver to exactly that window, and if not, is there
an in-repo remedy?

Verdict:

- The guard establishes a verified pre-condition at one instant and a fail-closed refusal.
  It does not establish delivery to the bound window. The primary route addresses a
  process; the window the app routes a key event to is decided inside the target app when
  it dequeues the event, after the guard's read.
- NSEvent-backed key events with a window number are not an in-repo-supported remedy.
  The repo binds only the mouse constructor, has never tried the keyboard one, and its own
  comments assert AppKit ignores the named window for keys. That assertion is unmeasured
  in-repo; one bounded probe settles it either way, but no design may depend on it today.
- Per-element accessibility operations are stronger for ownership of the acted-on object:
  they address an element reference, which does not move when the key window changes.
  They are a different action class (no key events), so they cannot stand in for typed-text
  tasks without changing what the benchmark measures.
- Window commands (menu items, key equivalents, posted chords) cannot honestly carry an
  exact-window guarantee. They are resolved by the app's responder chain at handling time.
  The honest claim is "bound window verified focused immediately before; no in-driver
  focus change afterwards", a pre-condition plus an observation, not a delivery property.

Recommendation (section 8): keep the PID route, convert "exact-window" from a delivery
claim into a bracketed verdict (pre-read, post-read, and an in-interval focus-change
watch), bound the unguarded interval for multi-event calls, and run the probes in
section 10 before the gate admits two-app fixtures. Do not substitute per-element actions
for typed text in scored tasks.

## 2. The dispatch path as it exists

Binding of a call to an observed window:

- `packages/core/src/computer/input-scope.ts:9` carries `windowId` on the scope target.
- `macos-input.ts` `beginCall` copies it into `InputCall.windowId`; `requireSessionWindow`
  (1005-1033) resolves the bound window through `boundWindow` (929), which refuses a window
  that is no longer on screen, then runs the keyboard branch:
  1. `focusStealWatcher(targetWindow)` under background delivery (124-129; process-level
     front restore via `focusGuardFor`, skylight.ts:242).
  2. `await keyboardWindowFocuser(pid, targetWindow.id)` (76-116): returns early when
     `focusedWindowIdForPid(pid) === windowId` or `focusedWindowIsModal(pid)`; otherwise
     `raiseWindowInApp` (AXRaise on the window element, accessibility.ts:443-470) when the
     focused window is a titled document, else a `Window > <title>` menu press whose
     failure is swallowed (113-115).
  3. The guard: `if (call.windowId !== undefined && focusedWindowIdForPid(pid) !==
     targetWindow.id) throw ...` (1027-1030). `focusedWindowIdForPid`
     (accessibility.ts:315-337) reads `AXFocusedWindow` on the application element and
     maps it with the private `_AXUIElementGetWindow` SPI (218-221). Any failure returns
     `undefined`, which the strict inequality refuses: the guard fails closed.
- `withWindowCommand` (492-515) runs the same focuser and the same read-back
  (`currentInputScope()?.target?.windowId !== undefined && focusedWindowIdForPid(pid) !==
  window.id`, 499-502) before `activateBehind` and the command.

Delivery after the guard:

- `postText` (664-688): one guard, then for every character `postUnicodeText` (coregraphics.ts
  91-102) posts a keyDown and a keyUp, with `TYPE_CHARACTER_DELAY_MS = 12` (220) between
  characters. `postKey` (695-738): one guard, keyDown, optional hold, keyUp in `finally`.
- `postKeyboardEvent` (coregraphics.ts:74-88) builds a CGEvent with
  `CGEventCreateKeyboardEvent` (coregraphics-bindings.ts:113-125), sets flags and the
  unicode string, and calls `postKeyboard` (173-193).
- `postKeyboard` requires `targetWindow` to be present but uses it only as a gate and as the
  fallback's address. Primary route: `postAuthenticatedSkyLightEventToPid(targetPid, event)`
  (skylight.ts:150-158): `SLSEventAuthenticationMessage messageWithEventRecord:pid:version:`
  (301-310), `SLEventSetAuthenticationMessage` (32), `SLEventPostToPid` (28). No window id is
  written anywhere on the keyboard event or its record. Fallback:
  `postCoreGraphicsEventToWindowOwner` (259-267) resolves the window's owner PSN with
  `SLSGetWindowOwner` (63) and `CGEventPostToPSN` (73); again a process address.
- The delivery pid is `keyboardPid(call)` (997-999) via `keyboardPidResolver` (144-145):
  when the focused window shows a Save/Open panel, the pid becomes the panel service's. The
  guard's read-back ran against `call.pid`, not against the pid the events go to.
- Contrast with mouse: `makeMouseEvent` (132-150) builds the event through
  `createNSEventBackedMouseEvent(..., targetWindow.id, ...)` (appkit.ts:76-107, selector at
  68-70), `stampTargetedMouseEvent` (232-258) writes CGEvent fields 91/92, a window-relative
  location and SkyLight field 40 = pid, and the notification-layer route hand-builds a
  record with the window id at offset `0x3c` (`buildMouseEventRecord`, skylight.ts:105,
  114-125). Pointer input names its window three ways; keyboard input names it zero ways.

In-repo statements of the routing model (intent, not measurement):

- macos-input.ts:71-74: "Keyboard events posted to a process go to its key window, not to
  the window they name".
- accessibility.ts:438-442: "AppKit hands key events to the key window whatever window the
  event names. AXRaise orders the window front inside its own app without activating the
  app".
- macos.ts:298-303 and macos-menu.ts:409-420: "a menu command acts on the app's key window".

Both comments predate any key event that names a window (`git log -S keyEventWithType --
packages` is empty; the mouse `windowNumber` binding arrived in `5830d4d`, the routing
comments in `851c8a8`).

## 3. What the guard establishes (supported invariants)

I1. Pre-dispatch focus equality. At the instant `focusedWindowIdForPid(pid)` answers, the
    app reports the bound window as `AXFocusedWindow`; otherwise nothing is posted. One read
    per call, before the first event of that call. (macos-input.ts:1027-1030, 499-502.)

I2. Fail-closed on unknown focus. An unreadable focus (`undefined`) refuses. (Same lines;
    accessibility.ts:331-333.)

I3. Process confinement. Every posted key event is addressed to one pid or PSN
    (skylight.ts:28, 73, 150-158, 259-267). The event cannot reach another app's window.
    The pid is the app's own except for the file-panel case in I6.

I4. On-screen binding. The bound window must be on screen for this app when the call starts
    (`boundWindow`, 929-943; `resolveTargetWindow` with `currentOnscreenWindowIds()`).

I5. Front-process restoration only. `focusStealWatcher` restores the previous front
    process (macos-focus-watch.ts:38-80 via `restoreFrontProcessNoWindows`,
    skylight.ts:255-257). It never reads or restores the target app's key window.

I6. Non-coverage is explicit. Unbound calls (`call.windowId === undefined`) get no read-back
    at all (1012-1014, 1027). File-panel delivery goes to another process after a read-back
    on the app (144-145, 997-999).

Supported by source reading only. The guard's unit tests
(`macos-input-window-focus.test.ts`, e.g. "#when an observed window is bound but an unrelated
modal has focus #then no keyboard event is posted") exercise this control flow against mocked
focus state; they show the refusal fires, not where a live event lands.

## 4. What remains vulnerable

The unguarded interval is: AX read answered -> JS resumes -> `SLEventPostToPid` ->
WindowServer queue -> target app dequeues -> `-[NSApplication sendEvent:]` picks the window.
Everything that can change the app's key window inside that interval re-routes the event
without any refusal.

V1. In-app focus changes after the read. The read is answered on the app's main thread, so
    it is ordered after work already dequeued, but not after deferred work (a sheet, alert
    or autosave panel opening from a previous action, a completion handler that makes a new
    document key). The event posted next goes to whatever is key when it is dequeued.

V2. Changes caused by this driver. `activateBehind` (385-412) posts `setProcessAppActive(psn,
    window.id, true)` (skylight.ts:200-207), which by its own comment makes the named window
    key; `keyboardWindowFocuser` raises windows; `invokeMenu(pid, ["Window", title])` makes
    one key. `typeText` (659-661) and `pressKey` (690-692) are not under `serialize` (556-563;
    only click, doubleClick and drag are). Two keyboard calls for the same pid bound to two
    windows can therefore interleave inside one controller: call B's AXRaise lands between
    call A's read-back and A's remaining characters. Whether a caller layer serializes
    per app is outside the sources read here (assumption U4).

V3. The person. A click on a window of the target app activates it and makes that window
    key; the watcher sends the app back behind the person's app (I5) but the key window
    inside the app stays changed. A deliberate switch stops the watcher entirely
    (macos-focus-watch.ts:50-56).

V4. Multi-event calls check once. A 40-character `typeText` spans at least 40 x 12 ms plus
    posting time with no re-read; `pressKey` with `holdMilliseconds` posts its keyUp wherever
    the key window is when the hold ends; `postWithHeldModifiers` (532-554) posts
    flagsChanged events before and after a gesture under the same single read.

V5. Delivery pid differs from the checked pid in the file-panel case (I6). The verified window
    belongs to the app; the keys go to the panel service, whose key window is the panel.
    Nothing asserts that the panel belongs to the bound window.

V6. The oracle is an AX attribute, not AppKit's dispatch target. `AXFocusedWindow` for an
    inactive app is whatever AppKit's accessibility layer reports; the key event is routed by
    `-[NSApplication sendEvent:]`. The two are assumed equal (U1). No in-repo artifact
    measures it.

V7. The fallback route is reachable without a signal. When
    `postAuthenticatedSkyLightEventToPid` returns false (class or selector missing, record
    pointer not found at offsets 24/32/16, skylight.ts:312-320), delivery silently switches to
    `CGEventPostToPSN`. The route taken is not reported to the caller, so a benchmark row
    cannot say which transport carried its keys.

None of V1-V7 is addressed by the guard. V2 and V4 are in-driver and bounded by design
choices; V1, V3 and V6 are properties of AppKit and the person and cannot be removed by a
pre-check, only shortened or detected.

## 5. Option A: NSEvent-backed key events with a window number

In-repo support: none. `appkit.ts` binds `mouseEventWithType:location:modifierFlags:
timestamp:windowNumber:context:eventNumber:clickCount:pressure:` (68-70) and `CGEvent`
(71); there is no `keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:
characters:charactersIgnoringModifiers:isARepeat:keyCode:` binding, no NSString bridging for
its two string arguments, and no history of either (`git log -S keyEventWithType` empty).
The alternative of writing the window id into the existing record (offset `0x3c`, the slot
`buildMouseEventRecord` fills for mouse records) through the `eventRecord` pointer is
mechanically possible with bindings already loaded (`SLEventSetIntegerValueField`, 37;
`koffi.decode` on the record) but has no documented field semantics for key events.

What it would establish if AppKit honored it: the window named on the event would be the
window `sendEvent:` targets, independent of the key window at dequeue time. That removes V1,
V2 and V3 for key events at window granularity. It does not choose the first responder inside
that window, does not help window commands (section 7), and does not touch V5.

What stands against it:

- The repo's own routing model (section 2 quotes) says the named window is ignored for keys.
  That model was never tested with a window-naming key event, so it is a belief, but it is
  also the conservative reading of AppKit's documented behaviour (key events go to the key
  window).
- A key event delivered to a non-key window, if it is delivered, enters `-[NSWindow
  sendEvent:]` on a window that has not become key: input-method marked text, key-equivalent
  matching and field-editor setup are all undefined for that case from the outside.
- The keyboard path is sensitive to duplicate and dropped delivery (postKeyboard comment,
  coregraphics.ts:179-184; `TYPE_CHARACTER_DELAY_MS` rationale, 217-220). A second
  construction path doubles the surface where that recurs.
- Cost: an eleven-argument `objc_msgSend` signature with two NSString arguments, CF string
  lifetime handling, a unicode-string carry check on the resulting CGEvent, unit tests, and
  a live probe. Risk of a null `CGEvent` from a synthesized key NSEvent is real and untested.

Assessment: not a remedy the gate can rely on. Worth exactly one scratch probe (P2 in
section 10) because the answer is binary and cheap to obtain; if negative, close the option
and record it in the ledger so it is not re-proposed.

## 6. Option B: per-element accessibility operations

Addressing: `performActionByIndex` (accessibility.ts:985-1016) and `setValueByIndex`
(1389-1396) resolve the retained `AXUIElementRef` of the observed element through
`refetchElement` (1398+), which re-reads the live element and refuses when role, label or
rounded frame y differ from the observation (`assertStillObservedControl`, 1689-1708), then
call `AXUIElementPerformAction` / `AXUIElementSetAttributeValue` on that element. The address
is the element token; the app resolves it to its own object on its main thread and acts on
that object. The key window at that moment plays no part in the addressing.
`pressElementAtScreenPoint` (1347-1387) goes further and refuses when
`containingWindowIds(element)` (1286) does not include the bound window id: the only place in
the read sources where window membership is asserted at act time.

Why it is stronger for ownership: an element does not change windows when the key window
changes, so the V1-V3 interval cannot re-route the action. The residual identity hazard is
element reuse (virtualised rows), which the shape check narrows but does not close, and
that hazard is about which control, not which window.

Where it is not stronger, or not applicable:

- Actions whose implementation consults the responder chain: a control with a nil target is
  dispatched by AppKit through the key window's responder chain, not the control's window.
  Toolbar items and most menu items behave this way; ordinary window controls with explicit
  targets do not. The read sources do not classify controls, so a press is exact-window only
  when the control acts on itself or on an explicit target (assumption U7).
- `AXPress` on a text-entry role is followed by `AXFocused = true` (1003-1011), which changes
  the app's focused element and may change its key window: a per-element press is itself one
  of the V1 events for any keyboard call that follows it.
- `setValueByIndex` bypasses key handling entirely (no key events, no input method, no
  per-keystroke undo). It is a different action from typing. The gate's constraint of no
  baseline substitutions means it cannot replace a typed-text task; it can only be the
  prescribed action of a task defined as set_value from the start.
- The Edit-command shortcuts (`editCommandOnTextField`, macos.ts:422-452;
  `selectAllInTextField`, 455-457) act on the app's focused element as read at act time
  (`AXFocusedUIElement`), not on an element of the bound window. They carry a
  focused-element guarantee, not a bound-window one, unless the focused element's window
  is also compared (not seen in the read sources).
- Web content: a press does not move keyboard focus and Safari reports no focused element in
  the background (1003-1025), which is why the fallback set `webFieldFocusedByPress` exists.

Assessment: stronger for ownership of the acted-on object, with the four exclusions above
stated. Use it where the task's prescribed action is already per-element; never as a
substitute path for keys.

## 7. Window commands: what can and cannot carry an exact-window claim

Cannot (resolved by the app's responder chain when the action fires, after any pre-check):

- Menu items pressed through accessibility: `invokeMenu` / `pressLeafDirectly`
  (macos-menu.ts:56-153), `pressMenuItem` (294), `invokeWindowMenu` (421-440).
- Key equivalents carried out as menu presses: `pressKeyEquivalent` (macos.ts:379-420),
  `planBackgroundKeyEquivalent` (macos-menu.ts:456+), `key` (macos.ts:260-297).
- Posted chords and keys: `pressKey` / `postKey` (section 2). AppKit matches key
  equivalents for the active app only (macos-menu.ts:447-455), so a posted Cmd chord to a
  background app is either ignored or re-planned as a menu press, both responder-chain
  resolved.
- Commands that change focus by definition (Window menu entries, New, Open, Close, Go to
  Folder): their result is a new key window; no claim about the bound window survives
  them. Finder's Go to Folder is already refused outright (macos.ts:324-363).
- Commands whose keys leave the app: Save/Open panels run in the panel service
  (keyboardPidResolver, macos-input.ts:144-145).

What `withWindowCommand` (macos-input.ts:492-515) honestly provides for these: the bound
window was the app's focused window immediately before the command (I1), the app was told
it is active with that window named as key (`activateBehind`, 385-412; `setProcessAppActive`,
skylight.ts:200-207), and nothing is posted when the read-back disagrees. That is a
pre-condition. Between the read-back and the app's `sendAction:`, the same V1-V3 interval
exists, lengthened by `waitForKeyEquivalentEnabled` / `waitForMenuItemEnabled` polling
(macos.ts:395-399; macos-menu.ts:432-435).

Can, with the stated exclusions: per-element operations of section 6 on controls that act on
themselves or on an explicit target, and `pressElementAtScreenPoint` with a window id.

## 8. Designs compared and recommendation

Design 1: verified bracket (recommended). Keep the authenticated PID route. Treat
"exact-window" as a benchmark verdict with three inputs: the pre-dispatch read-back that
already exists; a post-dispatch read-back of `AXFocusedWindow` after the last event of the
call; and an in-interval watch for the target app's focused-window change (an AXObserver on
the application element for the focused-window and main-window notifications; `ax-observer.ts`
subscribes `AXFocusedUIElementChanged` (37) but not a focused-window notification, so the
probe brings its own observer). A row is exact-window-owned when pre == bound, post == bound,
and the watch saw no focused-window change in between; otherwise it is recorded as
"ownership unverified" with the evidence. For multi-event calls, bound the interval: re-read
before each character or each N ms and stop with the count of characters already posted on
mismatch (a stop cannot un-post; it converts a silent misroute into a reported partial).
Trade-offs: no new transport, no new FFI surface, unit-testable through the existing
`setKeyboardWindowFocuserForTesting` seams, one extra AX round-trip per re-read (the same
cost the guard already pays once); it detects rather than prevents V1/V3, and it depends on
assumption U1 for the oracle, which P3 tests. Blast radius: `requireSessionWindow`,
`postText`, `postKey`, plus the benchmark runner's verdict code.

Design 2: window-named key events (Option A). Prevents V1-V3 for keys if AppKit honours the
window on the record. Trade-offs: new FFI surface with lifetime and null-return risks, a
second keyboard construction path to keep consistent with the duplicate/drop history, no
help for window commands or V5, and a binary unknown at its centre. Not adoptable without P2
returning positive; even then it is a prevention layer under Design 1, not a replacement for
the verdict.

Design 3: per-element only for gated tasks (Option B). Strongest ownership of the acted-on
object; changes the action class and therefore what is measured. Acceptable only for tasks
whose prescribed action is per-element already. Rejected as the general gate mechanism
because of the no-substitution constraint.

Why Design 1: it is the smallest change that makes the benchmark claim true, it needs no
unproven platform behaviour to be sound (only to be useful, via U1), and it leaves the
delivery path, which has a measured history of duplicate and dropped characters, untouched.
It also respects the operating constraints: all reads and watches are on the target app;
nothing activates any window; no unrelated window is touched.

Boundaries assumed: the verdict is per call; the caller serializes keyboard calls per app
(U4) or the bracket also records overlapping calls as unverified; the bound window is a
document window of the target app, with sheets and helpers classified separately (the
ledger's open "legitimate helper association" item).

Risks: notification latency can leave a short blind spot inside the bracket (the post-read
closes most of it, not all); per-character re-reads lengthen typing and could change timing
characteristics that other benchmark rows measure, so the re-read cadence should be a
recorded parameter; a post-read that differs from the pre-read after keys already landed is
a reported misroute, not a prevented one.

## 9. Unproven assumptions

Continuation source audit (2026-10-11): U4 is narrowed for guarded MCP
mutations. `GuardedSession.mutate` (guarded-session.ts:703-732) holds
`enqueue(laneForRequestedToken(token), ...)` around awaited input dispatch.
The lane is the observed PID (1723-1725), and the session owns the shared
promise tails (337-345, 1745-1763). Thus valid-token mutations for the same
PID share a queue within that session, including across script requests.
`ScriptRun.queue` adds a per-script app queue (script-tools.ts:342-358);
that queue alone is not cross-request protection because each request creates
a new ScriptRun (845-854).
This is source evidence, not a live delivery result. It does not establish
serialization across independent MCP sessions or raw controller callers,
nor prevent an app or human from changing its key window during dispatch.
The exact-window gate remains closed; no probe or GUI action was performed.

The existing benchmark observers cannot supply P6 evidence:
`window-event.swift` subscribes to window creation, title changes and exact
element destruction, not focused-window changes. `window-surface-event.swift`
checks whether an exact owned CG window surface is absent/offscreen; compositor
frames are wakeups, not focus evidence. Neither establishes an in-call
focused-window trace. Successful closure observations therefore cannot be
reused as keyboard ownership proof. Historical isolation was subsequently
waived by the user; this independent live ownership gate was not waived.

U1. `AXFocusedWindow` of an inactive app equals the window `-[NSApplication sendEvent:]`
    routes a posted key event to. Asserted by comments (macos-input.ts:71-74,
    accessibility.ts:438-442); no in-repo measurement.
U2. `SLEventPostToPid` delivers a key event to an inactive app at all, and to its key window.
    The repo relies on it (coregraphics.ts:179-191); the ledger reports typed text landing
    in TextEdit under background delivery, which supports delivery but not the window claim.
U3. AppKit ignores a window number on a key event record (section 5). Untested in-repo.
U4. Keyboard calls for one app are serialized by a layer above `MacOSInputController`;
    inside it, `typeText` and `pressKey` are not under `serialize` (V2).
U5. `setProcessAppActive(psn, windowId, true)` makes `windowId` the app's key window
    (skylight.ts:184-199 comment). Unmeasured; if false, `activateBehind` is not a V2
    source but `withWindowCommand`'s activation also names nothing.
U6. `AXRaise` on a background app's window changes `AXFocusedWindow` without activating
    the app (accessibility.ts:438-442). The guard would refuse if it did not, so the
    ledger's "successful raise with wrong focus read-back ... refuse" is unit evidence only.
U7. Per-element presses act on the element's own window except for nil-target controls
    (section 6). Control classification is not available from the read sources.
U8. The authenticated route is the one actually taken in live runs (V7); no artifact
    records which transport delivered a given row's keys.
U9. The guard under assessment is working-tree state, not a committed revision; the
    benchmark must pin the source hash it was evaluated against.

## 10. Minimal prospective verification plan

Constraints for every probe: background-only (the target app is never activated;
`frontProcessSerialNumber()` sampled before and after must be the same, unrelated process);
no baseline substitutions (typed text stays typed; per-element probes are separate rows);
all perturbations happen inside the target app (AXRaise of its own second window), never by
activating or touching an unrelated or personal window; fixture documents are created and
closed by the runner with independent AX inventory before and after, as the ledger already
requires. None of these probes has been run; the plan is the deliverable.

P1. Interval misroute, current design. Target app with two titled documents A and B, A
    bound. Inject a deterministic key-window flip to B between the guard's read-back and
    the first post (a scratch build with a hook after `requireSessionWindow`, not a source
    change), then `typeText` a marker. Read both documents' text over AX. Expected under the
    current model: marker in B, no refusal. Establishes V1 as real, not theoretical.

P2. Window-named key event (Option A). Same fixture, B key, a scratch-only key NSEvent with
    `windowNumber = A` posted through the same `SLEventPostToPid`. Marker in A: AppKit honours
    the window and Design 2 becomes a candidate. Marker in B or nowhere: close Option A in
    the ledger. Also record whether `-[NSEvent CGEvent]` returns null for the synthesized
    key event.

P3. Oracle equality (U1). Two documents, no perturbation: after `raiseWindowInApp(pid, A)`
    read `AXFocusedWindow`, type a marker, read where it landed. Repeat with B. The
    verdict's oracle is sound only if the two always agree.

P4. Multi-event split (V4) and the re-read remedy. Type a 40-character marker with a flip at
    about 200 ms. Current design: a split marker across A and B with no error. With a
    scratch per-character re-read: a refusal naming the count of characters already
    posted, and the AX text matching that count in A and nothing in B.

P5. Per-element ownership (Option B). With B key, `set_value` and `AXPress` on controls of
    A. Expected: A changes, B does not. Add one nil-target-style control (a toolbar item in
    the fixture app, if the fixture app has one) and record the outcome as the U7 data point
    rather than predicting it.

P6. Bracket watch latency (Design 1). Register the focused-window observer before P1's
    call; confirm the flip is reported inside the call's interval and record the lag between
    the AXRaise and the notification. The verdict's blind spot is that lag.

P7. Transport attribution (U8). Instrument the scratch build to record which branch of
    `postKeyboard` ran per event; confirm the authenticated route is the one taken on the
    benchmark host.

Each probe produces two numbers the gate can use: whether the marker landed in the bound
window, and whether the front process changed. A probe that activates anything is a failed
probe, not a data point.

## 11. Decision for the gate

Until P1, P3 and P6 are in the ledger, two-app fixtures beside personal windows remain
closed: the guard proves a pre-condition, and the benchmark cannot yet distinguish an
exact-window delivery from a misroute that happened to land where expected. The gate
reopens on Design 1 evidence (bracketed verdict with observer coverage), not on Option A,
and not on substituting per-element actions for typed text.
