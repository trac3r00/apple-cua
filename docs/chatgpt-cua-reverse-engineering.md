# How ChatGPT.app Does Computer Use — Reverse Engineering Report

Target: `/Applications/ChatGPT.app` (bundle id `com.openai.codex`, display name "ChatGPT",
Electron shell via `NSPrincipalClass = BrowserCrApplication`), build timestamp Sep 5 2026,
notarized by OpenAI OpCo. Analysis performed 2026-09-11 against the on-disk bundle.

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

- **"Skyshot" = one atomic observation**: screenshot + AX tree + revision, captured together.
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
  `scootPositionSettleVelocity`. The runtime waits for the UI to *stop changing* before
  capturing, instead of sleeping a fixed duration. The browser docs state the user-facing
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
| Skyshot = screenshot+AX+revision, atomic | §5 | Observation and the coordinates it authorizes can never disagree. |
| AX diff as the default observation | §4, §6 | Token efficiency; model sees only what changed. |
| AX-index actions, coordinate fallback | §4, §6 | Semantic targeting survives layout shifts; pixels only when needed. |
| AXTextMarker caret placement | §5 | Exact select/cursor ops without fragile pixel math. |
| Per-window ScreenCaptureKit stream | §5 | Full-fidelity window pixels, cached frames, no CLI spawn. |
| SkyshotClassifier image detection | §5 | Picks AX-text vs vision perception per screen. |
| `post_action_sleep_ms`, fixed `mouse_size_px` | §4 (full-desktop) | Deterministic action pacing; a visible cursor in every screenshot. |

## 8. Gap analysis vs this repo (`macos-cua`)

Already at parity: per-window SCK screenshot with viewport remap (`computer/viewport.ts`),
AX tree normalize (`accessibility/normalize.ts`), AX diff **counts** (`accessibility/diff.ts`),
`setValue`/`selectText`/`performAction` AX writes, app instructions, URL blocklist, app approval.

Remaining gaps (port candidates, ranked by value):

1. **Fixed 300 ms settle sleep** (`platform/macos.ts` `DEFAULT_APP_STATE_SETTLE_MILLISECONDS`)
   vs ChatGPT's event-driven settle. Blind sleep is slower when settled and unreliable when not.
   → Port: AX-stability-driven settle.
2. **AX diff returns only `{added, removed, changed}` counts**; the full normalized tree is
   re-sent every call. ChatGPT returns the diff tree itself.
   → Port: diff-text observation mode.
3. **`MAX_SCREENSHOT_LONG_EDGE = 1280`** (`computer/viewport.ts`) downscales Retina windows;
   ChatGPT captures full window fidelity. (Flagged in the old comparison doc too.)
4. **Actions return `void`**; ChatGPT's every action yields a fresh skyshot, so the model gets
   post-action verification for free.
5. No image-content classifier to choose AX vs vision perception.
