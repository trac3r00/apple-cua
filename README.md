# macos-cua

Native macOS computer-use control, designed for the OpenAI computer-use action vocabulary. Host-native (CGEvent / ScreenCaptureKit-class) speed, no VM sandbox required.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

## Why this exists

OpenAI Codex Computer Use is fast because it runs on the host with macOS-native APIs (ScreenCaptureKit, CoreGraphics, local MCP stdio). By contrast, [trycua/cua](https://github.com/trycua/cua) is portable but slow because of the multi-hop VM/HTTP/PIL pipeline: Python agent loop, 500 ms post-action screenshot delay, HTTP/WebSocket JSON to a guest FastAPI server, PIL encode, base64 SSE, client decode/re-encode. Codex removes the VM boundary and repeated image serialization; cua keeps it for sandbox isolation.

`macos-cua` is the Codex-style local path with cua's clean platform abstraction, written in strict TypeScript. It gives you the same `screenshot / click / type / key / scroll / drag` vocabulary that models expect, but executes directly on your Mac through native macOS APIs — `screencapture` for screen capture, `koffi`-bound CoreGraphics `CGEventPost` for global input, and a small Swift `cua-helper` SkyLight bridge for background per-PID mouse/keyboard delivery. No Docker, no QEMU, no VNC, no cloud API key.

The design trade-off is documented in [`codex-cua-comparison.md`](./codex-cua-comparison.md). If you need strong VM isolation, use cua. If you need low-latency host-native control, use this.

| | Codex | cua | macos-cua |
|---|---|---|---|
| Runs on | Host Mac | VM / container / cloud | Host Mac |
| Needs VM | No | Yes (default) | No |
| Needs API key | OpenAI only | Optional `CUA_API_KEY` for cloud | No |
| Screenshot path | Native ScreenCaptureKit / IOSurface | PIL `ImageGrab` in guest | `screencapture` CLI (ScreenCaptureKit FFI planned) |
| Input path | Native CGEvent / Apple Events | `pynput` in guest | Native CoreGraphics CGEvent via koffi + Swift SkyLight helper for per-PID mouse/keyboard |
| Transport | Local MCP stdio | HTTP/WebSocket JSON + SSE | Local process / MCP stdio / pi extension |
| Post-action delay | None reported | 500 ms default | None |
| Isolation | macOS permissions + app scoping | VM / container sandbox | macOS permissions only |

## Quickstart

```bash
git clone <repo>
cd macos-cua
pnpm install
pnpm --filter @macos-cua/core build
pnpm --filter @macos-cua/cli build
./packages/cli/dist/cli.js --version
./packages/cli/dist/cli.js screenshot -o /tmp/shot.png
```

Expected output:

```text
0.1.0
Screenshot saved to /tmp/shot.png
```

If the PNG is 0 bytes or black, grant Screen Recording permission to your terminal in **System Settings → Privacy & Security → Screen Recording**. See [`skills/macos-cua/references/installation.md`](./skills/macos-cua/references/installation.md) for the full permission walkthrough.

## The four surfaces

### CLI

The `macos-cua` binary is a thin `commander.js` wrapper over `MacOSHostComputer`.

```bash
# Screenshot (full screen or region)
macos-cua screenshot -o shot.png
macos-cua screenshot -o shot.png -x 100 -y 200 -w 800 -h 600

# Click and type
macos-cua click -x 500 -y 300
macos-cua type "Hello, world"

# Key chord
macos-cua key cmd --modifiers cmd,shift

# Query state
macos-cua cursor
macos-cua screen
```

Sample output:

```text
Screenshot saved to shot.png
Clicked at 500,300
Typed: Hello, world
Pressed: command+shift+cmd
1200,800
2560x1600
```

### Per-PID targeting

By default, input events go to the globally focused application. If you want the agent to drive a specific app while you keep focus elsewhere, pass `--target-pid <pid>` or `--target-bundle-id <id>` to any CLI call. Per-PID mouse, drag, and keyboard events are delivered through `packages/cua-helper`, a persistent Swift helper that posts NSEvent-bridged CGEvents via SkyLight without moving the real cursor or raising the target window. Per-PID scroll maps to authenticated helper key events (`PageUp` / `PageDown` / arrows) because Chromium drops private scroll-wheel posts.

Example: send a URL to Safari while Terminal stays focused:

```bash
# 1. get Safari's PID
SAFARI_PID=$(pgrep -x Safari)

# 2. focus Safari's address bar, type the URL, and press Return — all while Terminal keeps focus
macos-cua --target-pid "$SAFARI_PID" key l -m cmd
macos-cua --target-pid "$SAFARI_PID" type "https://example.com"
macos-cua --target-pid "$SAFARI_PID" key Return

# click/scroll/drag Safari content while Slack stays frontmost
macos-cua --target-pid "$SAFARI_PID" click -x 500 -y 300
macos-cua --target-pid "$SAFARI_PID" scroll --direction down --amount 5
macos-cua --target-pid "$SAFARI_PID" drag --from-x 100 --from-y 100 --to-x 300 --to-y 300
```

If `--target-pid` is used before the helper is built, the command fails with a clear build instruction instead of falling back to the global path. That preserves the no-focus-steal contract.

### Per-PID mouse/scroll/keyboard architecture

- **Global input** (no `--target-pid`) stays on the existing koffi CoreGraphics HID-tap path and remains backward compatible.
- **Per-PID mouse** uses the Swift helper. It creates AppKit `NSEvent.mouseEvent(...)` objects, bridges them to `CGEvent`, stamps target-window fields plus SkyLight field 40, and posts through `SLEventPostToPid`; left-clicks include the focus-without-raise + off-screen primer recipe Chromium/WebKit require.
- **Per-PID keyboard** uses SkyLight `SLSEventAuthenticationMessage` so Chromium omniboxes accept shortcuts and typed keys natively.
- **Per-PID text** uses Unicode CGEvent payloads so background text fields receive literal characters.
- **Per-PID scroll** is intentionally keyboard-backed (`PageUp`/`PageDown`/arrows), because Chromium silently drops private scroll-wheel events.

### MCP server

Spawn the stdio MCP server and wire it to Claude Desktop, VS Code, or any MCP client:

```bash
# Build
pnpm --filter @macos-cua/mcp build

# Run
./packages/mcp/dist/server.js
```

Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-cua": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/server.js"]
    }
  }
}
```

VS Code `settings.json` (MCP extension):

```json
{
  "mcp.servers": {
    "macos-cua": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/server.js"]
    }
  }
}
```

The server exposes 9 tools matching the OpenAI computer-use vocabulary. See the [Action surface](#action-surface) table below.

### pi-extension

Install into a [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) session:

```bash
pi install file://./packages/pi-extension
```

Loading the extension auto-enables Anthropic's `computer-use-2025-01-24` beta for Anthropic models: it injects the native `computer` tool, merges the required beta header/body fields, appends a short computer-use system prompt, and auto-detects display dimensions from `MacOSHostComputer.getScreenSize()`. No configuration is required. The trade-off is Anthropic's native computer-use overhead of roughly +1200 tokens per request (about 466-499 from the system prompt and 735 from the tool definition); advanced users can opt out with `MACOS_CUA_DISABLE_COMPUTER_USE_BETA=1` (`true`, `yes`, and `on` also work).

The extension also registers 9 tools with the `macos_cua_` prefix:

| Tool | Purpose |
|---|---|
| `macos_cua_screenshot` | Capture PNG screenshot (full or region) |
| `macos_cua_click` | Click at (x, y) |
| `macos_cua_double_click` | Double-click at (x, y) |
| `macos_cua_type` | Type text |
| `macos_cua_key` | Press key with modifiers |
| `macos_cua_scroll` | Scroll direction + amount |
| `macos_cua_drag` | Drag from (fromX, fromY) to (toX, toY) |
| `macos_cua_cursor_position` | Get cursor coordinates |
| `macos_cua_screen_size` | Get display dimensions |

The extension default-exports a pi extension factory and keeps the prefixed tools available even when Anthropic native computer-use beta injection is disabled.

### Programmatic API

Import `MacOSHostComputer` from `@macos-cua/core` and drive macOS directly:

```typescript
import { MacOSHostComputer } from "@macos-cua/core";

const computer = new MacOSHostComputer();

const { data, width, height } = await computer.screenshot();
await computer.click({ x: 500, y: 300 });
await computer.type("Hello from TypeScript");
await computer.key("Return", { modifiers: ["command"] });
await computer.scroll({ direction: "down", amount: 10 });
await computer.drag({ from: { x: 100, y: 200 }, to: { x: 300, y: 400 } });

const pos = await computer.getCursorPosition();
const size = await computer.getScreenSize();

await computer.close();
```

All methods return Promises. The API is intentionally identical to the OpenAI `Computer` abstraction so you can drop it into an agent loop without translation.

## Action surface

Every tool/action exposed by CLI, MCP, and pi-extension:

| Action | Parameters | Returns | What it does |
|---|---|---|---|
| `screenshot` | `region?: { x, y, width, height }` | PNG `Buffer` + dimensions | Full-screen or region capture via `screencapture` |
| `click` | `x: number`, `y: number` | void | Single click via CoreGraphics `CGEventCreateMouseEvent` / `CGEventPost` |
| `double_click` | `x: number`, `y: number` | void | Double click via CoreGraphics `CGEventCreateMouseEvent` / `CGEventPost` |
| `type` | `text: string` | void | Type literal text via CoreGraphics `CGEventCreateKeyboardEvent` |
| `key` | `key: string`, `modifiers?: string[]` | void | Key press with optional cmd/alt/ctrl/shift modifiers via CoreGraphics |
| `scroll` | `direction: "up" \| "down" \| "left" \| "right"`, `amount: number` | void | Scroll wheel event via CoreGraphics `CGEventCreateScrollWheelEvent` |
| `drag` | `fromX, fromY, toX, toY` | void | Mouse down, move, up via CoreGraphics `CGEventCreateMouseEvent` |
| `cursor_position` | none | `{ x, y }` | Current mouse coordinates via `CGEventGetLocation` |
| `screen_size` | none | `{ width, height }` | Desktop bounds via `osascript` |

## Permissions

macOS gates screen capture, input synthesis, and app lookup behind separate permission dialogs. The first time you run `screenshot` or `click`, macOS may prompt automatically. If it does not, grant them manually:

1. **System Settings → Privacy & Security → Screen Recording** — toggle your terminal/IDE ON.
2. **System Settings → Privacy & Security → Accessibility** — toggle the same terminal/IDE ON.
3. **System Settings → Privacy & Security → Apple Events** — allow the terminal/IDE if you use `--target-bundle-id` or permission helpers that query System Events.
4. Build and run `packages/core/dist/bin/cua-helper` once, then grant **Accessibility** to that helper binary too.
5. Restart the terminal (some apps cache the permission state at launch).

Permission is per-binary. If you switch from iTerm2 to Ghostty, you must re-grant for the new app.

Full walkthrough: [`skills/macos-cua/references/installation.md`](./skills/macos-cua/references/installation.md).

## Architecture

```text
+----------------------------------------------------------+
|  Agent / CLI / MCP client / pi session                   |
|  +----------------------------------------------------+  |
|  |  @macos-cua/core                                   |  |
|  |   ComputerInterface (abstract)                     |  |
|  |   +-- HostComputer  (macOS implemented)            |  |
|  |   +-- VMComputer    (stub: QEMU/Lume/VirtualBox)     |  |
|  |   +-- CloudComputer (stub: cloud provider)         |  |
|  +----------------------------------------------------+  |
|                    |                                     |
|  +-----------------+------------------+                 |
|  |                 |                  |                  |
|  v                 v                  v                  |
|  CLI            MCP server       pi-extension            |
|  commander.js   @modelcontext    registerTool factory    |
|                 protocol/sdk       default export          |
|  +----------------+------------------+                 |
|                    |                                     |
|  v                 v                  v                  |
|  screencapture   koffi/CGEvent     Swift cua-helper      |
|  (screenshots)   (global input)    (per-PID SkyLight)    |
+----------------------------------------------------------+
```

| Package | Path | Role |
|---|---|---|
| `@macos-cua/core` | [`packages/core`](./packages/core) | `ComputerInterface` + platform abstractions (`HostComputer`, `VMComputer`, `CloudComputer`) + `MacOSHostComputer` implementation |
| `cua-helper` | [`packages/cua-helper`](./packages/cua-helper) | Swift Package Manager executable for SkyLight per-PID mouse/keyboard delivery (not a pnpm package) |
| `@macos-cua/cli` | [`packages/cli`](./packages/cli) | `commander.js` binary (`macos-cua`) |
| `@macos-cua/mcp` | [`packages/mcp`](./packages/mcp) | MCP stdio server (`macos-cua-mcp`) exposing 9 tools |
| `@macos-cua/pi-extension` | [`packages/pi-extension`](./packages/pi-extension) | Pi coding-agent extension with `macos_cua_*` tool prefix |
| `skills/macos-cua` | [`skills/macos-cua`](./skills/macos-cua) | OpenCode-style skill definition + installation reference |

## Roadmap

| Feature | Status | Notes |
|---|---|---|
| macOS host-native screenshot | Implemented | `screencapture` CLI fallback |
| macOS host-native input | Implemented | Native CoreGraphics CGEvent via koffi for global input; Swift SkyLight helper for per-PID mouse/keyboard |
| QEMU runtime | Interface stub | [`packages/core/src/platform/vm.ts`](./packages/core/src/platform/vm.ts) |
| Lume runtime | Interface stub | Apple Virtualization.Framework VM |
| VirtualBox / Parallels runtime | Interface stub | Planned |
| Cloud provider runtime | Interface stub | [`packages/core/src/platform/cloud.ts`](./packages/core/src/platform/cloud.ts) |
| ScreenCaptureKit direct FFI | Future | Replace `screencapture` with `SCStream` / IOSurface for 60 fps capture |
| SkyLight authenticated per-PID mouse | Implemented | Swift `packages/cua-helper` uses `SLEventPostToPid`, focus-without-raise, NSEvent bridging, and keyboard auth messages. |
| Accessibility API queries | Future | `AXUIElement` for element-level targeting instead of coordinate-only |

## Development

```bash
# Install dependencies
pnpm install

# Type check + lint + test
pnpm check

# Test only
pnpm test

# Build all packages
pnpm build
```

Per-package builds:

```bash
pnpm --filter @macos-cua/core build
pnpm --filter @macos-cua/cli build
pnpm --filter @macos-cua/mcp build
pnpm --filter @macos-cua/pi-extension build
```

Standards: ultra-strict TypeScript, ESM with `.js` imports, Biome formatting, Vitest, tabs, line width 120. See [`AGENTS.md`](./AGENTS.md) for the full convention.

## Comparison vs cua / codex

| Dimension | cua | codex | macos-cua |
|---|---|---|---|
| Language | Python | Rust + proprietary plugin | TypeScript |
| Sandbox | VM / container / cloud | Host macOS (permission-scoped) | Host macOS (permission-scoped) |
| Screenshot latency | ~500 ms + encode + transport | Native frame interval + local IPC | `screencapture` CLI (FFI planned) |
| Input latency | HTTP → guest → pynput | Native CGEvent / Apple Events | Native CoreGraphics CGEvent via koffi (~microseconds per event) |
| Portability | Linux, macOS, Windows, Android, cloud | macOS only | macOS only (stubs for VM/cloud) |
| Open source | Full SDK | Plugin host OSS, Computer Use plugin proprietary | Fully open source |
| Agent integration | Any Python agent | Codex desktop only | CLI, MCP, pi-extension, or any TS agent |

Full analysis: [`codex-cua-comparison.md`](./codex-cua-comparison.md).

## License

MIT — see [LICENSE](LICENSE).

## Related

- [trycua/cua](https://github.com/trycua/cua) — upstream portable computer-use SDK (Python, VM-based)
- [OpenAI Codex](https://github.com/openai/codex) — Codex desktop app with proprietary Computer Use plugin
- [pi-mono](https://github.com/badlogic/pi-mono) — the pi coding-agent runtime
- [pi-cua-integration](https://github.com/code-yeongyu/pi-cua-integration) — pi extension that wraps cua sandboxes (the model for this README)
