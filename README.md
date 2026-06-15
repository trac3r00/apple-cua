# macos-cua

Native macOS computer-use control, designed for the OpenAI computer-use action vocabulary. Host-native (CGEvent / ScreenCaptureKit-class) speed, no VM sandbox required.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

## Why this exists

OpenAI Codex Computer Use is fast because it runs on the host with macOS-native APIs (ScreenCaptureKit, CoreGraphics, local MCP stdio). By contrast, [trycua/cua](https://github.com/trycua/cua) is portable but slow because of the multi-hop VM/HTTP/PIL pipeline: Python agent loop, 500 ms post-action screenshot delay, HTTP/WebSocket JSON to a guest FastAPI server, PIL encode, base64 SSE, client decode/re-encode. Codex removes the VM boundary and repeated image serialization; cua keeps it for sandbox isolation.

`macos-cua` is the Codex-style local path with cua's clean platform abstraction, written in strict TypeScript. It gives you the same app-oriented `list_apps / get_app_state / click / type_text / press_keys / scroll / drag` vocabulary that models expect, but executes directly on your Mac through native macOS APIs: `screencapture`/`sips` for screenshot capture, `koffi`-bound CoreGraphics for global input, Accessibility for app state/actions, and SkyLight/AppKit FFI for app-targeted window sessions. No Docker, no QEMU, no VNC, no helper binary, no cloud API key.

The design trade-off is documented in [`codex-cua-comparison.md`](./codex-cua-comparison.md). If you need strong VM isolation, use cua. If you need low-latency host-native control, use this.

| | Codex | cua | macos-cua |
|---|---|---|---|
| Runs on | Host Mac | VM / container / cloud | Host Mac |
| Needs VM | No | Yes (default) | No |
| Needs API key | OpenAI only | Optional `CUA_API_KEY` for cloud | No |
| Screenshot path | Native ScreenCaptureKit / IOSurface | PIL `ImageGrab` in guest | Native `screencapture` + `sips` fallback |
| Input path | Native CGEvent / Apple Events | `pynput` in guest | CoreGraphics CGEvent via koffi + SkyLight/AppKit FFI for app-targeted windows |
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

By default, input events go to the globally focused application. If you want the agent to drive a specific app, call `get_app_state` for that app first or pass `--target-pid <pid>` after the app has a visible window. The host implementation caches the app window session and routes mouse, drag, keyboard, text, and scroll events through CoreGraphics plus SkyLight/AppKit FFI. If no visible target window is known, targeted input fails loudly instead of falling back to global cursor-moving input.

Example: send a URL to Safari while Terminal stays focused:

```bash
# 1. get Safari's PID
SAFARI_PID=$(pgrep -x Safari)

# 2. focus Safari's address bar, type the URL, and press Return
# each CLI call primes the visible target window before dispatch
macos-cua --target-pid "$SAFARI_PID" key l -m cmd
macos-cua --target-pid "$SAFARI_PID" type "https://example.com"
macos-cua --target-pid "$SAFARI_PID" key Return

# click/scroll/drag Safari content while Slack stays frontmost
macos-cua --target-pid "$SAFARI_PID" click -x 500 -y 300
macos-cua --target-pid "$SAFARI_PID" scroll --direction down --amount 5
macos-cua --target-pid "$SAFARI_PID" drag --from-x 100 --from-y 100 --to-x 300 --to-y 300
```

If `--target-pid` is used before a target window has been discovered, the command fails with a clear app-session error instead of falling back to the global path.

### Per-PID mouse/scroll/keyboard architecture

- **Global input** (no `--target-pid`) stays on the koffi CoreGraphics HID-tap path and remains backward compatible.
- **Targeted mouse/drag** resolves a visible app window, creates AppKit-backed `CGEvent`s when a window is known, stamps target-window fields plus SkyLight field 40, activates the window without raising it, and posts through SkyLight plus the window owner's process serial number.
- **Targeted keyboard** requires a remembered app window and uses SkyLight `SLSEventAuthenticationMessage` before `SLEventPostToPid`.
- **Targeted text** uses per-character Unicode CGEvent payloads routed through the remembered app session.
- **Targeted scroll** requires the same remembered app window and refuses to fall back to the global event tap.

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

The server exposes 9 Codex Computer Use tools. See the [Action surface](#action-surface) table below.

### pi-extension

Install into a [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) session:

```bash
pi install file://./packages/pi-extension
```

Loading the extension auto-enables native computer-use for Anthropic Messages and OpenAI Responses models. Anthropic requests receive the `computer-use-2025-01-24` native `computer` tool plus the required beta header/body fields and a short system prompt. OpenAI Responses requests receive only `{ "type": "computer" }` in `payload.tools` — no headers, no `extra_body`, and no extra system prompt. No configuration is required; advanced users can opt out of both providers with `MACOS_CUA_DISABLE_COMPUTER_USE_BETA=1` (`true`, `yes`, and `on` also work).

The extension resolves the host display in logical macOS points, captures model-facing screenshots at a 1280px long edge (1280x720 on 16:9 displays), declares those dimensions to Anthropic, and unscales returned model coordinates back to logical points before dispatching clicks, moves, and drags. OpenAI Responses uses the same screenshot invariant: model coordinates are always in the image space the model received, while `MacOSHostComputer` still receives logical points.

The extension also registers Codex-compatible Computer Use tools:

| Tool | Purpose |
|---|---|
| `list_apps` | List running apps |
| `get_app_state` | Capture screenshot + accessibility tree for an app |
| `click` | Click by element index or screenshot coordinate |
| `perform_secondary_action` | Invoke an accessibility action by element index |
| `set_value` | Set a settable accessibility element value |
| `drag` | Drag between screenshot coordinates |
| `scroll` | Scroll an app by pages |
| `type_text` | Type literal text |
| `press_keys` | Press keys or key chords, with optional hold and interval timing |

The extension default-exports a pi extension factory and keeps these tools available even when native computer-use auto-activation is disabled.

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
| `screenshot` | `targetSize?: { width, height }` | PNG `Buffer` + dimensions | Full-screen capture via `screencapture` and `sips` |
| `click` | `x: number`, `y: number` | void | Single click via CoreGraphics `CGEventCreateMouseEvent` / `CGEventPost` |
| `double_click` | `x: number`, `y: number` | void | Double click via CoreGraphics `CGEventCreateMouseEvent` / `CGEventPost` |
| `type` | `text: string` | void | Type literal text via CoreGraphics `CGEventCreateKeyboardEvent` |
| `key` | `key: string`, `modifiers?: string[]` | void | Key press with optional cmd/alt/ctrl/shift modifiers via CoreGraphics |
| `scroll` | `direction: "up" \| "down" \| "left" \| "right"`, `amount: number` | void | Scroll wheel event via CoreGraphics `CGEventCreateScrollWheelEvent` |
| `drag` | `fromX, fromY, toX, toY` | void | Mouse down, move, up via CoreGraphics `CGEventCreateMouseEvent` |
| `cursor_position` | none | `{ x, y }` | Current mouse coordinates via `CGEventGetLocation` |
| `screen_size` | none | `{ width, height }` | Logical desktop bounds via Finder, with `system_profiler` fallback |

## Permissions

macOS gates screen capture, input synthesis, and app lookup behind separate permission dialogs. The first time you run `screenshot` or `click`, macOS may prompt automatically. If it does not, grant them manually:

1. **System Settings → Privacy & Security → Screen Recording** — toggle your terminal/IDE ON.
2. **System Settings → Privacy & Security → Accessibility** — toggle the same terminal/IDE ON.
3. **System Settings → Privacy & Security → Apple Events** — allow the terminal/IDE if you use `--target-bundle-id` or permission helpers that query System Events.
4. Restart the terminal (some apps cache the permission state at launch).

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
|  screencapture    koffi/CGEvent    SkyLight/AppKit FFI   |
|  (screenshots)    (global input)   (targeted sessions)   |
+----------------------------------------------------------+
```

| Package | Path | Role |
|---|---|---|
| `@macos-cua/core` | [`packages/core`](./packages/core) | `ComputerInterface` + platform abstractions (`HostComputer`, `VMComputer`, `CloudComputer`) + `MacOSHostComputer` implementation |
| `@macos-cua/cli` | [`packages/cli`](./packages/cli) | `commander.js` binary (`macos-cua`) |
| `@macos-cua/mcp` | [`packages/mcp`](./packages/mcp) | MCP stdio server (`macos-cua-mcp`) exposing Codex Computer Use tools |
| `@macos-cua/pi-extension` | [`packages/pi-extension`](./packages/pi-extension) | Pi coding-agent extension with Codex-compatible Computer Use tools |
| `skills/macos-cua` | [`skills/macos-cua`](./skills/macos-cua) | OpenCode-style skill definition + installation reference |

## Roadmap

| Feature | Status | Notes |
|---|---|---|
| macOS host-native screenshot | Implemented | `screencapture` + `sips` capture and resize |
| macOS host-native input | Implemented | Native CoreGraphics CGEvent via koffi for global input; SkyLight/AppKit FFI for targeted app windows |
| QEMU runtime | Interface stub | [`packages/core/src/platform/vm.ts`](./packages/core/src/platform/vm.ts) |
| Lume runtime | Interface stub | Apple Virtualization.Framework VM |
| VirtualBox / Parallels runtime | Interface stub | Planned |
| Cloud provider runtime | Interface stub | [`packages/core/src/platform/cloud.ts`](./packages/core/src/platform/cloud.ts) |
| ScreenCaptureKit capture | Planned | Current implementation uses the system screenshot fallback while the TypeScript FFI path stays helper-free |
| SkyLight authenticated targeted input | Implemented | TypeScript FFI uses `SLEventPostToPid`, focus-without-raise, AppKit-backed mouse events, and keyboard auth messages |
| Accessibility API queries | Implemented | `AXUIElement` tree extraction, `set_value`, and secondary actions |

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
| Screenshot latency | ~500 ms + encode + transport | Native frame interval + local IPC | Native one-shot screenshot fallback |
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
