# Architecture reference

Why macos-cua takes the host-native path, how the layers stack, and where the project is headed.

## Philosophy: host-native over sandbox

macos-cua is designed for the same OpenAI computer-use action vocabulary that Codex uses, but it runs directly on the host Mac instead of inside a VM sandbox. See [`codex-cua-comparison.md`](../../codex-cua-comparison.md) at the repo root for the full analysis.

The key trade-off:

- **Sandbox path** (trycua/cua style): strong isolation via Docker/QEMU/Lume, but pays for VM boot, guest services, HTTP/JSON transport, PIL screenshot encoding, base64 serialization, and a default 500 ms post-action delay.
- **Host-native path** (macos-cua style): no VM boundary, no transport hops, no repeated base64 cycles. Screenshots currently use the system `screencapture` + `sips` fallback. Global input goes through `koffi`-bound CoreGraphics CGEvent, while targeted app input goes through TypeScript-owned SkyLight/AppKit FFI and a cached visible window session.

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
│    screencapture/sips → PNG buffer                       │
│    koffi/CGEvent → global mouse/keyboard/scroll          │
│    SkyLight/AppKit FFI → targeted app sessions           │
│    Finder/system_profiler → logical screen size          │
│  VMComputer (interface only)                             │
│  CloudComputer (interface only)                            │
└─────────────────────────────────────────────────────────┘
```

## Current implementation

`MacOSHostComputer` lives in `packages/core/src/platform/macos.ts`. It implements the full `ComputerInterface` contract using macOS-native APIs:

- **Screenshots**: `screencapture` captures the primary display and `sips` resizes the PNG to the requested target dimensions.
- **Global input**: `koffi`-bound CoreGraphics CGEvent for click, double-click, type, key chords, scroll, and drag. Events are posted globally via `CGEventPost` by default, preserving the original behavior.
- **Targeted input**: `MacOSInputController` resolves visible windows with `get-windows`, remembers the target window after `get_app_state` or pointer routing, and posts through SkyLight/AppKit FFI. It refuses targeted keyboard, text, mouse, and scroll when no target window is known.
- **Queries**: Finder desktop bounds provide logical screen size, with `system_profiler SPDisplaysDataType` as a cold fallback. `CGEventGetLocation(CGEventCreate(NULL))` reports the current cursor position.

## Computer-use coordinate scaling

The pi-extension keeps model coordinates and macOS input coordinates separate:

1. `MacOSHostComputer.getScreenSize()` returns logical desktop points.
2. `computeDownscale()` downscales those logical dimensions to a 1280px long edge while preserving aspect ratio.
3. Screenshots returned through native computer-use are resized to `targetWidth x targetHeight`.
4. Model actions are interpreted in that resized image space. `unscaleCoordinate()` maps them back to logical points before `click`, `move`, or `drag` reaches `MacOSHostComputer`.

Pipeline shorthand: logical points → 1280-edge screenshot → model coordinate → unscaled logical point → macOS input.

Anthropic receives `display_width_px` and `display_height_px` set to the downscaled model dimensions. OpenAI Responses needs only `{ type: "computer" }`, but follows the same resized-screenshot and unscale-on-action invariant.

## Reserved interfaces

Two platform implementations exist as stubs:

- `VMComputer` — for QEMU, Lume, or other VM-based control. Currently throws `Not implemented`.
- `CloudComputer` — for remote instance control. Currently throws `Not implemented`.

These are placeholders for future expansion. The `ComputerInterface` contract is intentionally platform-agnostic so that a single automation script can switch from `MacOSHostComputer` to `VMComputer` by changing one import.

## Targeted mouse / scroll / keyboard (Implemented)

Targeted input is helper-free and stays inside the TypeScript process:

- **Mouse left-click**: resolve a visible target window, activate it without raising via PSN focus records, create AppKit-backed mouse `CGEvent`s when a window is known, stamp `mouseEventSubtype = 3`, `mouseEventClickState`, target window IDs, `CGEventSetWindowLocation` for window-local coords, and SkyLight raw field 40 = pid. Events post through `SLEventPostToPid` plus the window owner's process serial number.
- **Mouse right / middle / drag**: use the same target-window stamping and SkyLight/window-owner delivery, without the global `CGEventPostToPid` fallback.
- **Keyboard**: standard `CGEventCreateKeyboardEvent`, then `SLEventSetAuthenticationMessage` via `+[SLSEventAuthenticationMessage messageWithEventRecord:pid:version:]`, posted via `SLEventPostToPid`.
- **Type text**: per-character `CGEvent` with `CGEventKeyboardSetUnicodeString` routed through the remembered app session.
- **Scroll**: wheel events require the remembered app window and use SkyLight/window-owner delivery; without a remembered session the call fails before any event is posted.

## Future work

The current architecture is fully functional. Planned improvements:

1. **Display selection** — support `--display` for multi-monitor setups.
2. **Streaming frames** — add an IOSurface/SCStream path for higher frame-rate observation when one-shot screenshots are not enough.
