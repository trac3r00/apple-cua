# Usage reference

How to drive the user's real Mac via `macos-cua`, the MCP server, the pi-extension, or programmatic imports.

Prerequisites: [`installation.md`](installation.md) completed, OS-level permissions granted.

## CLI verbs at a glance

| Verb | Purpose | Typical call |
|---|---|---|
| `screenshot` | Capture the active display | `macos-cua screenshot -o /tmp/shot.png` |
| `click` | Single click at (x,y) | `macos-cua click -x 100 -y 200` |
| `type` | Type literal text | `macos-cua type "Hello, world"` |
| `key` | Press a key with modifiers | `macos-cua key s -m cmd,shift` |
| `cursor` | Get cursor position | `macos-cua cursor` |
| `screen` | Get screen size | `macos-cua screen` |

Run `macos-cua --help` or `macos-cua <verb> --help` for the full flag set.

## The screenshot-then-Read recipe

The single most important recipe. `macos-cua` writes the PNG to disk; pi's Read tool ingests it as inline image content.

```bash
# capture with a unique filename so concurrent calls don't collide
TS=$(date +%s%N)
SHOT="/tmp/macos-cua-${TS}.png"
macos-cua screenshot -o "${SHOT}"
```

Then in the **same agent turn**, call pi's Read tool with the absolute path `/tmp/macos-cua-<ts>.png`. The PNG is attached to the next assistant message as inline image content. Do not base64 it manually, do not pipe it through stdin. Read already does the right thing.

## Click, type, and key

```bash
# single click
macos-cua click -x 540 -y 380

# type literal text (shell-quote carefully)
macos-cua type "Hello, world!"

# key chords — modifiers are comma-separated
macos-cua key s -m cmd          # save
macos-cua key t -m cmd,shift    # reopen closed tab
macos-cua key Return            # bare named keys also work
```

## MCP server

Start the MCP server over stdio:

```bash
pnpm macos-cua-mcp
```

The server exposes these tools:

- `screenshot` — capture the screen, optionally with a region.
- `click` — click at (x, y).
- `double_click` — double-click at (x, y).
- `type` — type text.
- `key` — press a key with optional modifiers.
- `scroll` — scroll in a direction (up, down, left, right) by an amount.
- `drag` — drag from one point to another.
- `cursor_position` — get the current cursor position.
- `screen_size` — get the screen dimensions.

A typical MCP `tools/call` request for a screenshot:

```json
{
  "name": "screenshot",
  "arguments": {}
}
```

## pi-extension

Install the extension into pi:

```bash
pi install file:///Users/<you>/local-workspaces/macos-cua/packages/pi-extension
```

Restart pi. The extension registers `macos_cua_*` tools (screenshot, click, double_click, type, key, scroll, drag, cursor_position, screen_size) directly inside pi's tool surface.

## Programmatic usage

Import from `@macos-cua/core` when building a custom automation script:

```typescript
import { MacOSHostComputer } from "@macos-cua/core";

const computer = new MacOSHostComputer();

const result = await computer.screenshot();
// result.data is a Buffer containing PNG bytes
// result.mimeType is "image/png"

await computer.click({ x: 100, y: 200 });
await computer.type("Hello from TypeScript");
await computer.key("s", { modifiers: ["command"] });

const pos = await computer.getCursorPosition();
const size = await computer.getScreenSize();

await computer.close();
```

## Common end-to-end patterns

### Find a button on screen, then click it

```bash
# 1. screenshot
TS=$(date +%s%N) ; SHOT="/tmp/macos-cua-${TS}.png"
macos-cua screenshot -o "${SHOT}"
# 2. (agent turn) Read /tmp/macos-cua-${TS}.png to look at it and decide coordinates
# 3. click
macos-cua click -x 540 -y 380
# 4. verify
TS=$(date +%s%N) ; SHOT="/tmp/macos-cua-${TS}.png"
macos-cua screenshot -o "${SHOT}"
# 5. Read again to confirm the click had the intended effect
```

### Open an app then drive it

```bash
# open the app via pi's bash (preferred for shell commands)
open -a "Visual Studio Code"
sleep 1   # give the app a moment to focus
macos-cua key s -m cmd,shift   # cmd+shift+s (save as)
```

## Concurrency and serialization

`macos-cua` calls are serialized at the OS-event level on the same host. Don't interleave clicks and keystrokes from parallel invocations and expect deterministic ordering. Keep automation sequential within a single agent turn, or insert short `sleep` calls between independent actions when timing matters.
