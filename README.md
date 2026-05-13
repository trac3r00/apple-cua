# macos-cua

Native macOS computer-use control, designed for the OpenAI computer-use action vocabulary. Host-native (CGEvent / ScreenCaptureKit-class) speed, no VM sandbox required.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

## Why this exists

OpenAI Codex Computer Use is fast because it runs on the host with macOS-native APIs (ScreenCaptureKit, CoreGraphics, local MCP stdio). By contrast, [trycua/cua](https://github.com/trycua/cua) is portable but slow because of the multi-hop VM/HTTP/PIL pipeline: Python agent loop, 500 ms post-action screenshot delay, HTTP/WebSocket JSON to a guest FastAPI server, PIL encode, base64 SSE, client decode/re-encode. Codex removes the VM boundary and repeated image serialization; cua keeps it for sandbox isolation.

`macos-cua` is the Codex-style local path with cua's clean platform abstraction, written in strict TypeScript. It gives you the same `screenshot / click / type / key / scroll / drag` vocabulary that models expect, but executes directly on your Mac through `screencapture` and `cliclick` (with ScreenCaptureKit/CoreGraphics FFI planned). No Docker, no QEMU, no VNC, no cloud API key.

The design trade-off is documented in [`codex-cua-comparison.md`](./codex-cua-comparison.md). If you need strong VM isolation, use cua. If you need low-latency host-native control, use this.

| | Codex | cua | macos-cua |
|---|---|---|---|
| Runs on | Host Mac | VM / container / cloud | Host Mac |
| Needs VM | No | Yes (default) | No |
| Needs API key | OpenAI only | Optional `CUA_API_KEY` for cloud | No |
| Screenshot path | Native ScreenCaptureKit / IOSurface | PIL `ImageGrab` in guest | `screencapture` CLI (ScreenCaptureKit FFI planned) |
| Input path | Native CGEvent / Apple Events | `pynput` in guest | `cliclick` CLI (CGEvent FFI planned) |
| Transport | Local MCP stdio | HTTP/WebSocket JSON + SSE | Local process / MCP stdio / pi extension |
| Post-action delay | None reported | 500 ms default | None |
| Isolation | macOS permissions + app scoping | VM / container sandbox | macOS permissions only |

## Quickstart

```bash
git clone <repo>
cd macos-cua
pnpm install
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

The extension registers 9 tools with the `macos_cua_` prefix:

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

The extension default-exports an `activate` factory that takes a `registerTool` context and an optional `{ display?: number }` config.

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
| `click` | `x: number`, `y: number` | void | Single click via `cliclick` |
| `double_click` | `x: number`, `y: number` | void | Double click via `cliclick` |
| `type` | `text: string` | void | Type literal text via `cliclick` |
| `key` | `key: string`, `modifiers?: string[]` | void | Key press with optional cmd/alt/ctrl/shift modifiers |
| `scroll` | `direction: "up" \| "down" \| "left" \| "right"`, `amount: number` | void | Scroll wheel event via `cliclick` |
| `drag` | `fromX, fromY, toX, toY` | void | Mouse down, move, up via `cliclick` |
| `cursor_position` | none | `{ x, y }` | Current mouse coordinates via `cliclick` |
| `screen_size` | none | `{ width, height }` | Desktop bounds via `osascript` |

## Permissions

macOS gates screen capture and input synthesis behind two separate permission dialogs. The first time you run `screenshot` or `click`, macOS may prompt automatically. If it does not, grant them manually:

1. **System Settings → Privacy & Security → Screen Recording** — toggle your terminal/IDE ON.
2. **System Settings → Privacy & Security → Accessibility** — toggle the same terminal/IDE ON.
3. Restart the terminal (some apps cache the permission state at launch).

Permission is per-binary. If you switch from iTerm2 to Ghostty, you must re-grant for the new app.

Optional dependency: `cliclick` for input synthesis. Install via `brew install cliclick`. `screencapture` is built into macOS.

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
|  screencapture   cliclick          osascript             |
|  (screenshots)   (mouse/keyboard)  (screen size)         |
+----------------------------------------------------------+
```

| Package | Path | Role |
|---|---|---|
| `@macos-cua/core` | [`packages/core`](./packages/core) | `ComputerInterface` + platform abstractions (`HostComputer`, `VMComputer`, `CloudComputer`) + `MacOSHostComputer` implementation |
| `@macos-cua/cli` | [`packages/cli`](./packages/cli) | `commander.js` binary (`macos-cua`) |
| `@macos-cua/mcp` | [`packages/mcp`](./packages/mcp) | MCP stdio server (`macos-cua-mcp`) exposing 9 tools |
| `@macos-cua/pi-extension` | [`packages/pi-extension`](./packages/pi-extension) | Pi coding-agent extension with `macos_cua_*` tool prefix |
| `skills/macos-cua` | [`skills/macos-cua`](./skills/macos-cua) | OpenCode-style skill definition + installation reference |

## Roadmap

| Feature | Status | Notes |
|---|---|---|
| macOS host-native screenshot | Implemented | `screencapture` CLI fallback |
| macOS host-native input | Implemented | `cliclick` CLI fallback |
| QEMU runtime | Interface stub | [`packages/core/src/platform/vm.ts`](./packages/core/src/platform/vm.ts) |
| Lume runtime | Interface stub | Apple Virtualization.Framework VM |
| VirtualBox / Parallels runtime | Interface stub | Planned |
| Cloud provider runtime | Interface stub | [`packages/core/src/platform/cloud.ts`](./packages/core/src/platform/cloud.ts) |
| ScreenCaptureKit direct FFI | Future | Replace `screencapture` with `SCStream` / IOSurface for 60 fps capture |
| CGEvent FFI for input | Future | Replace `cliclick` with `CGEventCreate` / `CGEventPost` |
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
| Input latency | HTTP → guest → pynput | Native CGEvent / Apple Events | `cliclick` CLI (FFI planned) |
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
