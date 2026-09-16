# How ChatGPT.app Does Computer Use — Reverse Engineering Report

Target: `/Applications/ChatGPT.app` (bundle id `com.openai.codex`, display name "ChatGPT",
Electron shell via `NSPrincipalClass = BrowserCrApplication`), build timestamp Sep 5 2026,
notarized by OpenAI OpCo. Analysis performed 2026-09-11 against the on-disk bundle.

Confidence: shipped JS/types establish the tool contract. Native symbols establish that
capabilities exist, not their exact algorithms, defaults, synchronization guarantees or
performance. The macos-cua changes are independent implementations, not proof of identical
ChatGPT model intelligence or speed. See §8 for current limitations and corrections.

This supersedes `codex-cua-comparison.md`, which analyzed the older Codex.app 1.0.809 era
(`SkyComputerUseClient mcp`). The current app has replaced that MCP-tool design with a
**persistent JavaScript REPL** architecture.

## 1. Process topology

```text
ChatGPT.app (Electron shell)
  └─ unified-computer-use plugin (v26.901.51231)
       └─ MCP server "cua_repl": node scripts/launch.mjs
            └─ spawns cua_node/bin/node_repl  (Node 24.19.0, custom REPL binary, 18.7 MB)
                 ├─ trusted service "sky"     → @oai/sky/service      (native computer use)
                 └─ trusted service "browser" → @oai/browser-desktop/service
                      └─ @oai/sky "Codex Computer Use.app"
                           ├─ Contents/MacOS/SkyComputerUseService        (22.9 MB Swift binary, does the work)
                           ├─ Contents/SharedSupport/SkyComputerUseClient.app
                           └─ Contents/SharedSupport/CUALockScreenGuardian.app
```

Evidence:
- `Contents/Resources/plugins/openai-bundled/plugins/unified-computer-use/.codex-plugin/plugin.json`
- `Contents/Resources/plugins/openai-bundled/plugins/unified-computer-use/.mcp.json`
- `Contents/Resources/plugins/openai-bundled/plugins/unified-computer-use/scripts/launch.mjs`
- `Contents/Resources/cua_node/manifest.json` (node 24.19.0, runtime `cua-node-0.0.9`)
- `Contents/Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app/Contents/Info.plist`
  (`CFBundleIdentifier = com.openai.sky.CUAService`, `CFBundleShortVersionString = 26.831.1000926`)
- App entitlement group `2DC432GLL2.com.openai.sky.CUAService` (from `codesign -d --entitlements`).

## 2. The tool contract: one `js` tool, not per-action tools

The MCP server exposes exactly two tools: `js` and `js_reset`
(`.mcp.json`: `enabled_tools: ["js", "js_reset"]`, `js` output token limit 25000).

There are **no** `click`/`screenshot`/`type` MCP tools. The model writes JavaScript that runs
in a persistent REPL against an initialized CUA runtime. On first call the model runs exactly one
API call (e.g. `await cua.getState()` or `await cua.getApp("Safari")`); the result includes
documentation plus initial UI state. After that the model batches arbitrarily many operations
into a single `js` call.

Evidence:
- `Contents/Resources/plugins/openai-bundled/plugins/unified-computer-use/resources/js-tool-description.md`
- `.../resources/js-reset.md`, `.../resources/server-instructions.md`
  ("UI automation through a persistent JavaScript session using the initialized CUA API.")
- `.../resources/banner-computer.js` — the REPL banner is literally:
  `await (await import("@oai/cua/tinyskyAlt")).setupCUA({ browser: false, computer: true });`

**This is the core speed technique: batching.** One model turn = one tool call = N UI actions
plus the state read, instead of N screenshot→action round trips.

## 3. The REPL-facing API (`@oai/cua` v0.2.4, "tinyskyAlt")

From `Contents/Resources/cua_node/lib/node_modules/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/types.d.ts`:

- `cua.initialize()`, `cua.getState()` → inventory of `{ apps, browsers[{tabs}] }`.
- `cua.getApp(name|bundleId|path)` → binds a native app, returns an `App` (a `Target`),
  and **displays its initial full accessibility state**.
- Every `Target` (app or browser tab) shares one interaction surface:
  `getAXState({disableDiffing})`, `getScreenshot()`, `getAXStateAndScreenshot()`,
  `click(elementIndex | [x,y], {mouseButton, clickCount})`, `drag(from, to)`,
  `pressKey(key)` (xdotool-style chords: `"a"`, `"Return"`, `"super+c"`, `"KP_0"`),
  `scroll(elementIndex | [x,y], direction, pages)`, `selectText(index, text, {prefix, suffix, selectionType})`,
  `setValue(index, value)`, `typeText(text)`, `paste(text, {format: "text"|"md"|"html"})`,
  `performSecondaryAction(index, action)`.

Evidence: `.../tinysky_alt/types.d.ts`, `.../tinysky_alt/globals.d.ts`, `.../cua.d.ts`.

## 4. The native client API (`@oai/sky` v0.6.26)

Three target flavors under
`Contents/Resources/cua_node/lib/node_modules/@oai/sky/dist/project/cua/sky_js/src/types/`:

- **`window/` (target "mac")** — the macOS flavor used here:
  `click, drag, get_app_state, list_apps, paste, perform_secondary_action, press_key, scroll,
   select_text, set_value, type_text` (+ optional audio recording).
  `get_app_state({app, disableDiff})` returns `AppState { app, screenshot: {url} | null, text }`
  where `text` is "Accessibility text, prefixed with app-specific guidance on first access".
  Actions take `element_index` (from the latest `get_app_state` text) **or** `x,y` in the
  app-window screenshot's pixel space. `select_text` supports `selection_type:
  "text" | "cursor_before" | "cursor_after"` with `prefix`/`suffix` disambiguation.
- **`window2/` (target "windows")** — per-window variant with `activate_window`, `list_windows`,
  `get_window_state`, `launch_app`.
- **`full-desktop/` (target "linux")** — pure coordinate desktop: `click(x, y, {key, duration})`,
  `move`, `drag_handle`, `get_screenshot` returning `{filepath, bytes, data_url}` per display.
  Its options reveal two more speed techniques: `post_action_sleep_ms` (default 100) and
  `mouse_size_px` (default 12 — pointer is drawn into screenshots at a fixed size).

Evidence: `.../types/window/*.d.ts`, `.../types/window2/*.d.ts`, `.../types/full-desktop/*.d.ts`.

The JS layer is thin. Each op (e.g. `targets/mac/click.js`, `get_app_state.js`) wraps a policy
check (`withComputerUsePolicy`) and forwards to a lazily-imported client
(`targets/mac/lazy-client.js`) that speaks to the native service over a **native pipe**
(`targets/mac/native-pipe.js`: `MacNativePipeTransport`, 8 MB buffer, 5 s timeout) using
`ComputerUseIPC*` request messages (`targets/mac/client.js`:
`ComputerUseIPCAppGetSkyshotRequest`, `ComputerUseIPCAppPerformActionRequest`,
`ComputerUseIPCListAppsRequest`, `ComputerUseIPCAppStartRequest`, …).

## 5. The native engine: SkyComputerUseService (Swift)

`.../Codex Computer Use.app/Contents/MacOS/SkyComputerUseService` links
`ScreenCaptureKit.framework`, `ApplicationServices` (AX), `CoreGraphics`, `AppKit`.
Symbol/string evidence (`nm -gU`, `strings -a`) shows the perception/action pipeline:

- **"Skyshot" groups observation data**: screenshot + AX tree + revision. Atomic capture
  is not established by the type/symbol names alone.
  Types: `ComputerUseIPCSkyshot`, `ComputerUseIPCSkyshotResult`, `SkyshotCapture`,
  `SkyshotOperation`, `ComputerUseSkyshotAttachment`, `computerUseAppControllerDidUpdateSkyshot`.
- **ScreenCaptureKit streaming**, not one-shot `screencapture`: `SCStream`,
  `SCStreamDelegate`, `SCStreamOutput`, `SCStreamFrameInfo`, `SCContentFilter`,
  `SCStreamConfiguration`, `waitForSamplePresentationAspect(fallback:useCached:)`.
- **Revision-tracked AX tree with refetch**: `UIElementTreeRevision`, `windowRevision`,
  `contentRevision`, `previousRevision`, `_previousWindowRevision`, `RefetchableSkyshotAXTree`,
  `_hadAxText`, and an "invalidation monitor" on every skyshot.
- **UI-settle gating (the key speed+accuracy technique)**: `needsUISettleBeforeSkyshot`,
  `onSettled`, `onSourceResizeSettled`, `lockUISettleDelay`, `SystemLockScreenSettleObservation`,
  `scootPositionSettleVelocity`. These suggest settle handling; they do not establish an
  event-driven algorithm or rule out fixed delays in the native app. The browser docs state the user-facing
  contract: "It is usually not necessary to pause or delay between performing an action and
  getting the updated page state. The runtime automatically waits an appropriate amount of time
  before capturing the new state."
- **SkyshotClassifier** (`_TtC11ComputerUse17SkyshotClassifier`,
  "Enables classifier to determine if Skyshot contains image or not",
  `feature/skyshotClassifier`) — detects image-heavy screens, presumably to decide between
  AX-text and vision perception.
- **Precise text selection via AX text markers**: `AXTextMarker`, `AXTextMarkerRange`,
  `AXTextualContext`, `AXTextualContextSourceCode`, `cursor_before`, `cursor_after` —
  this is how `select_text` places the caret exactly.
- **Input via CGEvent**: `CGEvent`, `CGEventSource`, `CGEventSourceStateID`,
  `CGEventTapLocation`, `eventWithCGEvent:`, `failedToCreateCGEvent`.
- **Lock-screen safety**: separate `CUALockScreenGuardian.app`.

The older per-app `sky.node` (`Contents/Resources/native/sky.node`, a Swift `SkyNative`
module) provides window listing (`CGWindow` wrappers, `skyFrontmostWindowJSON`), app icons,
status-item and PiP hosting for the Electron shell — it is *not* the CUA action path.

## 6. Perception philosophy (from shipped docs)

`@oai/browser-desktop/docs/accessibility.md` and `api-use-behavior.md` encode the policy the
model is taught:

1. **AX-first**: "Use the accessibility API as the primary way to inspect and interact…
   Prefer accessibility state and actions targeting accessibility indices over inspecting the
   DOM, or actions using locators or coordinates." Coordinate actions are the fallback.
2. **Diff by default**: "the accessibility tree will be returned as a diff from the previous
   accessibility tree, listing only the elements that were removed, added, or changed. Prefer
   this default diff output; use … `disableDiffing: true` only when you need a fresh full tree."
3. **Re-derive indices every step**: element indices are only valid against the latest AX text;
   after actions you re-read state before acting again.
4. **Cheapest sufficient observation**: "collect the cheapest state check that answers the next
   question… avoid requesting both [AX and screenshot] by default."
5. **Batch**: "Batch as many actions as possible and the resulting `ax.write()` into one Node
   REPL `js` call."
6. **No blind retries**: "If an interaction has no effect, do not blindly repeat it… Inspect
   the visible state for a blocker… then retry the most direct semantic action."

## 7. What makes it fast and accurate — the portable techniques

| Technique | Where | Why it wins |
|---|---|---|
| JS-REPL batching, one `js` tool | §2 | Eliminates per-action model/tool round trips. |
| Event-driven UI settle before capture | §5 (`needsUISettleBeforeSkyshot`, `onSettled`) | Faster than a fixed sleep when UI is already settled; more reliable than a fixed sleep when it is not. |
| Skyshot groups screenshot+AX+revision | §5 | Helps relate observations; atomicity and stale-target guarantees remain unverified. |
| AX diff as the default observation | §4, §6 | Token efficiency; model sees only what changed. |
| AX-index actions, coordinate fallback | §4, §6 | Semantic targeting survives layout shifts; pixels only when needed. |
| AXTextMarker caret placement | §5 | Exact select/cursor ops without fragile pixel math. |
| Per-window ScreenCaptureKit stream | §5 | Full-fidelity window pixels, cached frames, no CLI spawn. |
| SkyshotClassifier image detection | §5 | Picks AX-text vs vision perception per screen. |
| `post_action_sleep_ms`, fixed `mouse_size_px` | §4 (full-desktop) | Deterministic action pacing; a visible cursor in every screenshot. |

## 8. Current macos-cua implementation and limitations

- `getAppState` supports window viewport remapping and normalized AX trees. Display and
  window capture are both native ScreenCaptureKit now: window frames come from
  `sckit_capture_window` in `libsckit.dylib` (`platform/macos-ffi/screenshot.ts`), and
  main-display capture falls back to `CGDisplayCreateImage` when that path is unavailable.
  A window the native path cannot capture falls back to `screencapture -l` plus `sips`.
  Capture is still one-shot rather than a persistent per-window stream. Region requests crop
  the display image in CoreGraphics, so regions are PNG, and a display id can replace the
  main display; the dimensions the driver reports always match the encoded image.
- `waitForUiSettle` polls AX trees at 40 ms intervals with a nominal 300 ms budget.
  This is a local heuristic, not an event subscription or a recovered ChatGPT algorithm.
  AX read cost can exceed the nominal budget; no comparative speed claim is established.
- `axChanges` contains element-level changes. `diffOnly` / `diff_only` returns an empty
  `elements` array after a prior snapshot; first capture is full. This is opt-in, and the
  screenshot is still captured. Changes in the tree are observations, not proof of success.
- The screenshot/model cap is now **2560**, a local fidelity/cost choice rather than a
  recovered ChatGPT default. It does not guarantee Retina backing-pixel fidelity.
- `contentKind` is an AX-role/area heuristic (`accessibility/content-kind.ts`), not a
  pixel classifier or a copy of OpenAI's classifier. Empty AX data recommends vision;
  that does not prove the screen contains a photograph.
- `observeAction` runs the action then reads state. The shipped `@oai/sky` macOS
  `types/window/Click.d.ts` and `SetValue.d.ts` actually return `Promise<void>`; the earlier
  assertion that every ChatGPT action automatically returns a skyshot was incorrect.
- Native `element_index` is the returned element **`id`**, never its position in a filtered
  array. Obtain it from the latest state. Index guessing and acting on unsupported controls
  are invalid QA scenarios. Native AX references now remain attached to the latest captured
  IDs within the process, so a later hierarchy insertion cannot silently retarget an action.
  A new snapshot replaces that mapping; IDs are not durable across sessions or snapshots.

Matching API vocabulary does not establish full behavioral parity. Native action reliability,
observation truthfulness, timing and safe target identity require independent live verification.

### AX error interpretation

Apple's `HIServices.framework/Headers/AXError.h` defines `-25200` as generic failure,
`-25205` as unsupported attribute, `-25206` as unsupported action, and `-25208` as not
implemented. Earlier reports mapped these incorrectly. A failed write to the app root or
an unsupported Finder scroll operation does not by itself prove broken FFI bindings.

### Reproduced native action fix (2026-09-12)

A disposable AppKit fixture proved a separate, real stale-target failure: after a snapshot
assigned ID 4 to a button, insertion of a preceding control made a fresh tree walk resolve
ID 4 to a text field. `AXPress` then failed with `-25206`. Retaining the snapshot's native
AXUIElement references lets the same observed ID press the intended button despite the
insertion. The regression also covers value writes and text-selection ranges.

Snapshots are replaced on capture and released on computer close, unavailable Accessibility
or dead-PID lookup. Unknown IDs in a matching snapshot fail instead of targeting an unobserved
new node. Direct calls without a matching snapshot retain the legacy fresh-walk behavior.

Independent Swift and Node/Koffi probes both succeeded for supported field writes and button
presses, and both rejected unsupported actions. This disproves the earlier blanket claim of
broken FFI signatures. It does not establish the cause of every Finder-specific AX rejection.

Observed action results now expose `observationStatus`: `unavailable` (no baseline),
`unchanged`, or `changed`. These describe the AX comparison, not whether the user's intended
outcome occurred. In particular, a missing baseline must not claim an action registered, and
an unchanged tree must not trigger an automatic retry of a potentially non-idempotent action.
