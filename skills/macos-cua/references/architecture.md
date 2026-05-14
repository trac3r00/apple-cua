# Architecture reference

Why macos-cua takes the host-native path, how the layers stack, and where the project is headed.

## Philosophy: host-native over sandbox

macos-cua is designed for the same OpenAI computer-use action vocabulary that Codex uses, but it runs directly on the host Mac instead of inside a VM sandbox. See [`codex-cua-comparison.md`](../../codex-cua-comparison.md) at the repo root for the full analysis.

The key trade-off:

- **Sandbox path** (trycua/cua style): strong isolation via Docker/QEMU/Lume, but pays for VM boot, guest services, HTTP/JSON transport, PIL screenshot encoding, base64 serialization, and a default 500 ms post-action delay.
- **Host-native path** (macos-cua style): no VM boundary, no transport hops, no repeated base64 cycles. Screenshots go straight from `screencapture` (and eventually ScreenCaptureKit) to disk. Input goes straight from `koffi`-bound CoreGraphics CGEvent (`CGEventPost` for global; `CGEventPostToPid` for per-PID) to the OS event stream.

The result is lower latency and real-app fidelity. The cost is weaker environmental isolation, so the agent must never auto-drive destructive UI without user confirmation.

## Layer diagram

```text
┌─────────────────────────────────────────────────────────┐
│  Entry points                                            │
│  CLI (macos-cua) │ MCP server (macos-cua-mcp) │ pi-ext  │
├─────────────────────────────────────────────────────────┤
│  @macos-cua/core                                         │
│  ComputerInterface (abstract contract)                   │
│    screenshot() → ScreenshotResult                       │
│    click() / doubleClick() / type() / key() / scroll()   │
│    drag() / getCursorPosition() / getScreenSize()        │
├─────────────────────────────────────────────────────────┤
│  Platform implementations                                │
│  MacOSHostComputer (implemented)                         │
│    screencapture → PNG buffer                            │
│    koffi/CGEvent → mouse/keyboard (global or per-PID)    │
│    osascript → screen bounds                             │
│  VMComputer (interface only)                             │
│  CloudComputer (interface only)                            │
└─────────────────────────────────────────────────────────┘
```

## Current implementation

`MacOSHostComputer` lives in `packages/core/src/platform/macos.ts`. It implements the full `ComputerInterface` contract using macOS-native APIs:

- **Screenshots**: `screencapture -x -` (captures to stdout as PNG bytes). Region capture is supported via `-R x,y,w,h`.
- **Input**: `koffi`-bound CoreGraphics CGEvent for click, double-click, type, key chords, scroll, and drag. Events are posted globally via `CGEventPost` by default, or targeted to a specific PID via `CGEventPostToPid` when per-PID targeting is enabled.
- **Queries**: `system_profiler SPDisplaysDataType` reports the screen size (chosen specifically because it does not require Apple Events permission and won't hang) and `CGEventGetLocation(CGEventCreate(NULL))` reports the current cursor position.

## Reserved interfaces

Two platform implementations exist as stubs:

- `VMComputer` — for QEMU, Lume, or other VM-based control. Currently throws `Not implemented`.
- `CloudComputer` — for remote instance control. Currently throws `Not implemented`.

These are placeholders for future expansion. The `ComputerInterface` contract is intentionally platform-agnostic so that a single automation script can switch from `MacOSHostComputer` to `VMComputer` by changing one import.

## Per-PID mouse / scroll / keyboard (Implemented)

Per-PID input goes through `packages/cua-helper`, a 167 KB Swift binary that talks JSON over stdin/stdout. The TypeScript wrapper (`MacOSCuaHelper`) lazily spawns it on first use, matches replies on uuid id, and auto-restarts on subprocess crash. Recipes:

- **Mouse left-click**: `FocusWithoutRaise.activateWithoutRaise` (yabai-style 248-byte PSN defocus + focus event records via `SLPSPostEventRecordTo`) → 50 ms settle → `mouseMoved` at target → 15 ms → off-screen `(-1, -1)` primer down/up (opens Chromium's user-activation gate) → 100 ms → target down/up pair. Each event is built via `NSEvent.mouseEvent(...).cgEvent` (raw `CGEventCreateMouseEvent` is filtered by Chromium), stamped with `mouseEventSubtype = 3`, `mouseEventClickState`, target window IDs, `CGEventSetWindowLocation` for window-local coords, and SkyLight raw field 40 = pid. Posted via `SLEventPostToPid` without auth message.
- **Mouse right / middle / modifier-held**: skip the primer, NSEvent-bridged `rightMouseDown/Up` / `otherMouseDown/Up` / modified `leftMouseDown/Up` posted via `postBoth` (SkyLight + public `CGEvent.postToPid`).
- **Drag**: NSEvent-bridged down + linearly-interpolated `mouseDragged` events + up, all stamped + posted via `postBoth`.
- **Keyboard**: standard `CGEventCreateKeyboardEvent`, then `SLEventSetAuthenticationMessage` via `+[SLSEventAuthenticationMessage messageWithEventRecord:pid:version:]` (Chromium omnibox accepts these as trusted), posted via `SLEventPostToPid`.
- **Type text**: per-character `CGEvent` with `keyboardSetUnicodeString` (UTF-16), no auth message, posted via `SLEventPostToPid`.
- **Scroll**: keyboard `PageUp` / `PageDown` / arrows repeated `amount` times. Wheel events posted per-PID are silently dropped by Chromium (no SkyLight scroll auth subclass).

The Swift helper is built by `bash packages/cua-helper/build.sh` (also invoked automatically by `pnpm --filter @macos-cua/core build`) and copied to `packages/core/dist/bin/cua-helper`. Non-Darwin hosts and missing Swift toolchain skip cleanly. `MACOS_CUA_HELPER_PATH` env var overrides binary resolution.

## Future work

The current architecture is fully functional. Planned improvements:

1. **ScreenCaptureKit / IOSurface** — replace `screencapture` with a native addon that uses `SCStream` for GPU-backed, low-latency capture. Removes the subprocess spawn overhead and enables streaming frames instead of one-shot files.
2. **AXUIElement semantic targeting** — add `AXUIElementPerformAction(kAXPressAction)` paths for buttons / links / toolbar items so the agent can click named elements without coordinates. Falls back to the helper pixel-click path for canvas / WebGL surfaces.
3. **Display selection** — support `--display` for multi-monitor setups.
