# Architecture reference

Why macos-cua takes the host-native path, how the layers stack, and where the project is headed.

## Philosophy: host-native over sandbox

macos-cua is designed for the same OpenAI computer-use action vocabulary that Codex uses, but it runs directly on the host Mac instead of inside a VM sandbox. See [`codex-cua-comparison.md`](../../codex-cua-comparison.md) at the repo root for the full analysis.

The key trade-off:

- **Sandbox path** (trycua/cua style): strong isolation via Docker/QEMU/Lume, but pays for VM boot, guest services, HTTP/JSON transport, PIL screenshot encoding, base64 serialization, and a default 500 ms post-action delay.
- **Host-native path** (macos-cua style): no VM boundary, no transport hops, no repeated base64 cycles. Screenshots go straight from `screencapture` (and eventually ScreenCaptureKit) to disk. Input goes straight from `cliclick` (and eventually CoreGraphics CGEvent) to the OS event stream.

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
│    cliclick → CGEvent mouse/keyboard                     │
│    osascript → screen bounds                             │
│  VMComputer (interface only)                             │
│  CloudComputer (interface only)                            │
└─────────────────────────────────────────────────────────┘
```

## Current implementation

`MacOSHostComputer` lives in `packages/core/src/platform/macos.ts`. It implements the full `ComputerInterface` contract using macOS-native CLI tools:

- **Screenshots**: `screencapture -x -` (captures to stdout as PNG bytes). Region capture is supported via `-R x,y,w,h`.
- **Input**: `cliclick` for click, double-click, type, key chords, scroll, and drag. `cliclick` is a thin wrapper around CoreGraphics CGEvent, so the eventual migration path is to call CGEvent directly via a native addon or FFI.
- **Queries**: `osascript` asks Finder for the desktop bounds, and `cliclick p` reports the current cursor position.

## Reserved interfaces

Two platform implementations exist as stubs:

- `VMComputer` — for QEMU, Lume, or other VM-based control. Currently throws `Not implemented`.
- `CloudComputer` — for remote instance control. Currently throws `Not implemented`.

These are placeholders for future expansion. The `ComputerInterface` contract is intentionally platform-agnostic so that a single automation script can switch from `MacOSHostComputer` to `VMComputer` by changing one import.

## Future work

The current CLI-tool approach is pragmatic but not the final architecture. Planned improvements:

1. **ScreenCaptureKit / IOSurface** — replace `screencapture` with a native addon that uses `SCStream` for GPU-backed, low-latency capture. This removes the subprocess spawn overhead and enables streaming frames instead of one-shot files.
2. **CoreGraphics CGEvent direct** — replace `cliclick` with direct CGEvent calls via Node-API or a small Swift/ObjC bridge. This removes the `cliclick` dependency and enables finer control over event timing.
3. **Accessibility APIs** — add `osascript`-based UI element queries (button labels, window titles) so the agent can target elements by name instead of raw coordinates.
4. **Display selection** — support `--display` for multi-monitor setups.

Until those land, the `screencapture` + `cliclick` stack is fully functional and requires no compiled native dependencies beyond what macOS and Homebrew already provide.
